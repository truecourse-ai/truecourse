/**
 * THE OVERLAP SESSION — `spec-scan.overlap`, one per area.
 *
 * What is under test is the SESSION'S CONTRACT and the run's FOLD around it,
 * driven through the real `runSpecScanSessions` on a scripted `SessionDriver`:
 *
 * - `sectionsOpened` is counted off the TRANSCRIPT, never self-reported;
 * - every returned pointer is re-anchored by `verifyOverlapSections` in the
 *   fold (a fabricated heading with a verbatim quote lands on the lead);
 * - `check_findings` refuses bad anchors IN SESSION (validator-as-tool);
 * - cross-area dedup + the confidence auto-apply run unchanged behind it;
 * - the per-area cache invalidates on one doc edit;
 * - a `budget-exhausted` area lands its `notReached` IN THE CORPUS and does not
 *   abort the run, while a kind that lost EVERY session to transport aborts
 *   BEFORE the corpus write.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetKvCacheStore } from '@truecourse/llm'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import {
  OVERLAP_SESSION_BUDGET,
  OVERLAP_SESSION_CACHE_NAME,
  OVERLAP_SESSION_KIND,
  OVERLAP_SESSION_SYSTEM_PROMPT,
  overlapSessionDef,
  validateOverlapFindings,
  type OverlapOutcome,
} from '../../packages/core/src/services/spec-scan/overlap'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { buildScanUniverse } from '../../packages/core/src/services/spec-scan/tools'
import {
  readCorpus,
  readDecisions,
  writeDecisions,
  type DecisionsFile,
  type DocCandidate,
} from '../../packages/spec-consolidator/src/index.js'
import { LlmStageFailureError } from '@truecourse/shared/llm'
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionIndexEntry,
  SessionPersistence,
  SessionRunInput,
  TurnUsage,
} from '../../packages/agent-loop/src/index'

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

/** The opening message the session is working from — the briefing on a fresh
 *  run, the transcript's last `user-message` on a resumed one. */
function openingOf(input: SessionRunInput): string {
  const last = input.initialMessages.at(-1)
  if (last !== undefined) return last
  for (const event of [...(input.resume?.events ?? [])].reverse()) {
    if (event.type === 'user-message') return event.content
  }
  return ''
}

const briefedDoc = (input: SessionRunInput): string =>
  /^PATH \(repo-relative\): (.+)$/m.exec(openingOf(input))?.[1] ?? ''
const briefedArea = (input: SessionRunInput): string =>
  /^Area: (.+)$/m.exec(openingOf(input))?.[1] ?? ''

type Script = (kind: string, input: SessionRunInput) => Promise<DriverResult>

/**
 * A driver that runs `script` per session. Two things it does beyond the
 * script, both because a real driver does them and the shell reads them back:
 * it records `user-message` as it ingests each opening message, and — unless
 * the script already called the tool — it records a `check_findings`
 * tool-result before an overlap outcome. The overlap session def carries an
 * `outcomePrecondition` on `check_findings`, so a session that never ran it has
 * its FIRST outcome refused; a script standing in for a model that followed the
 * prompt has run it.
 */
function scriptedDriver(script: Script, opts: { checksFindings?: boolean } = {}): SessionDriver {
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      let ranCheck = false
      const observed: SessionRunInput = {
        ...input,
        onEvent: (event) => {
          if (event.type === 'tool-result' && event.toolName === 'check_findings') ranCheck = true
          input.onEvent(event)
        },
      }
      for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content })
      const done = (async () => {
        await new Promise((r) => setTimeout(r, 0))
        const result = await script(input.def.kind, observed)
        if (
          result.kind === 'outcome' &&
          input.def.kind === OVERLAP_SESSION_KIND &&
          !ranCheck &&
          opts.checksFindings !== false
        ) {
          input.onEvent({
            type: 'tool-result',
            toolName: 'check_findings',
            content: 'The draft is valid.',
            isError: false,
          })
        }
        return result
      })()
      return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} }
    },
  }
  return driver
}

/** Call a session tool the way a driver does, recording the turn + its result. */
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

function memoryPersistence(): { persistence: SessionPersistence } {
  const events = new Map<string, SessionEvent[]>()
  const index = new Map<string, SessionIndexEntry>()
  const persistence: SessionPersistence = {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? []
      list.push(event)
      events.set(sessionId, list)
    },
    updateIndex(entry) {
      index.set(entry.sessionId, entry)
    },
    readEvents(sessionId) {
      return events.get(sessionId) ?? []
    },
  }
  return { persistence }
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------

let repo: string
beforeEach(() => {
  resetKvCacheStore()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-overlap-'))
})
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

function writeDocs(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(repo, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
}

/** The overlap kind's on-disk cache dir — derived from the cache NAME, so a
 *  rename cannot leave these cases quietly reading nothing. */
function overlapCacheDir(): string {
  return path.join(repo, '.truecourse', '.cache', ...OVERLAP_SESSION_CACHE_NAME.split('/'))
}

/** Rewrite every cached overlap entry in the shape a run BEFORE `sectionsOpened`
 *  existed wrote it. Returns how many entries were rewritten. */
function stripSectionsOpenedFromCache(): number {
  let stripped = 0
  for (const name of fs.readdirSync(overlapCacheDir())) {
    const file = path.join(overlapCacheDir(), name)
    const value = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    if (!('sectionsOpened' in value)) continue
    delete value.sectionsOpened
    fs.writeFileSync(file, JSON.stringify(value, null, 2))
    stripped++
  }
  return stripped
}

/** Cover the whole universe so the scope orchestrator (step 6) spends nothing —
 *  these cases are about the overlap kind, not about scope. */
function coverScope(): void {
  const decisions: DecisionsFile = {
    version: 2,
    manualIncludes: [],
    manualExcludes: [],
    manualAreas: [],
    conflictResolutions: [],
    scopeVerdicts: [
      { path: '.', verdict: 'keep', reason: 'root', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
      { path: 'docs', verdict: 'keep', reason: 'specs', decidedAt: '2026-01-01T00:00:00Z', resolvedBy: 'user' },
    ],
    instructions: [],
  }
  writeDecisions(repo, decisions)
}

const AUTH_MD = `# Auth

Sessions authenticate users; every access token is minted here.

## Token lifetime

Access tokens expire after 15 minutes.
`

const SESSION_MD = `# Session

## Token lifetime

Access tokens expire after 60 minutes.
`

// An OUTSIDE doc — tagged \`core/notes\`, but its \`## Authentication\` heading
// slug-matches the \`auth\` concern, so the widened net briefs it into core/auth.
const NOTES_MD = `# Notes

## Authentication

Tokens are minted by the auth service.
`

const SOLO_MD = `# Solo

## Deployment

Nothing here collides with anything.
`

/** The curate-doc verdict a doc gets, by path. */
type Tagging = Record<string, Array<{ product: string; concern: string }>>

function curateVerdict(tagging: Tagging, docPath: string): DriverResult {
  return {
    kind: 'outcome',
    value: { keep: true, reason: 'spec source', areas: tagging[docPath] ?? [{ product: 'core', concern: 'misc' }] },
  }
}

const EMPTY_SETTLEMENT: DriverResult = {
  kind: 'outcome',
  value: { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] },
}

/** Run the scan with a script that only has to answer the OVERLAP sessions. */
async function runScan(opts: {
  tagging: Tagging
  overlap: (areaId: string, input: SessionRunInput) => Promise<DriverResult>
  checksFindings?: boolean
}) {
  const { persistence } = memoryPersistence()
  const driver = scriptedDriver(async (kind, input) => {
    if (kind === CURATE_DOC_SESSION_KIND) return curateVerdict(opts.tagging, briefedDoc(input))
    if (kind === SETTLE_AREAS_SESSION_KIND) return EMPTY_SETTLEMENT
    if (kind === OVERLAP_SESSION_KIND) return opts.overlap(briefedArea(input), input)
    throw new Error(`unscripted session kind: ${kind}`)
  }, opts.checksFindings === false ? { checksFindings: false } : {})
  const result = await runSpecScanSessions({
    repoRoot: repo,
    driver: async () => driver,
    persistence,
    skipGit: true,
  })
  return { result }
}

// ---------------------------------------------------------------------------
// sectionsOpened — counted off the transcript, never self-reported
// ---------------------------------------------------------------------------

describe('sectionsOpened', () => {
  beforeEach(() => {
    writeDocs({ 'docs/auth.md': AUTH_MD, 'docs/session.md': SESSION_MD })
    coverScope()
  })

  it('counts the session\'s real read_section results, not anything the outcome claims', async () => {
    const { result } = await runScan({
      tagging: {
        'docs/auth.md': [{ product: 'core', concern: 'auth' }],
        'docs/session.md': [{ product: 'core', concern: 'auth' }],
      },
      overlap: async (_areaId, input) => {
        await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        await callTool(input, 'read_section', { doc: 'docs/session.md', heading: 'Token lifetime' })
        const draft: OverlapOutcome = { overlaps: [], notReached: [] }
        await callTool(input, 'check_findings', draft)
        return { kind: 'outcome', value: draft }
      },
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.sectionsOpened).toBe(2)
  })

  it('records zero for a session that opened nothing', async () => {
    const { result } = await runScan({
      tagging: {
        'docs/auth.md': [{ product: 'core', concern: 'auth' }],
        'docs/session.md': [{ product: 'core', concern: 'auth' }],
      },
      overlap: async (_areaId, input) => {
        const draft: OverlapOutcome = { overlaps: [], notReached: [] }
        await callTool(input, 'check_findings', draft)
        return { kind: 'outcome', value: draft }
      },
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.sectionsOpened).toBe(0)
  })

  /**
   * The stamp made `sectionsOpened` a legal OUTCOME field (the estimate probes
   * the same cache entries with this `.strict()` schema, so a sibling shape was
   * not an option). A session may therefore now claim a count without being
   * refused as malformed — and the transcript still wins, before anything reads
   * or caches the value.
   */
  it('overrides a SELF-REPORTED count with the transcript\'s, without failing the session', async () => {
    const { result } = await runScan({
      tagging: {
        'docs/auth.md': [{ product: 'core', concern: 'auth' }],
        'docs/session.md': [{ product: 'core', concern: 'auth' }],
      },
      overlap: async (_areaId, input) => {
        await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        const draft: OverlapOutcome = { overlaps: [], notReached: [] }
        await callTool(input, 'check_findings', draft)
        // The session claims 99; it opened one section.
        return { kind: 'outcome', value: { ...draft, sectionsOpened: 99 } }
      },
    })
    // Not a malformed rejection — the session completed.
    expect(result.sessions.find((s) => s.kind === OVERLAP_SESSION_KIND)).toMatchObject({ ran: 1, failed: 0 })
    expect(result.corpus.areas.find((a) => a.id === 'core/auth')!.sectionsOpened).toBe(1)

    // …and the claim never reached the cache either: the stamp lands BEFORE the
    // write, so a later hit cannot resurrect the self-report.
    const entries = fs
      .readdirSync(overlapCacheDir())
      .map((name) => JSON.parse(fs.readFileSync(path.join(overlapCacheDir(), name), 'utf-8')))
    expect(entries).toHaveLength(1)
    expect(entries[0].sectionsOpened).toBe(1)
  })

  it('does not count an ERRORED read_section (a heading the doc does not have)', async () => {
    const { result } = await runScan({
      tagging: {
        'docs/auth.md': [{ product: 'core', concern: 'auth' }],
        'docs/session.md': [{ product: 'core', concern: 'auth' }],
      },
      overlap: async (_areaId, input) => {
        await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        const miss = await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Nope' })
        expect(miss).toContain('has no section')
        const draft: OverlapOutcome = { overlaps: [], notReached: [] }
        await callTool(input, 'check_findings', draft)
        return { kind: 'outcome', value: draft }
      },
    })
    expect(result.corpus.areas.find((a) => a.id === 'core/auth')!.sectionsOpened).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// the fold re-anchors — never trust the transcript
// ---------------------------------------------------------------------------

describe('the fold re-verifies every pointer', () => {
  beforeEach(() => {
    writeDocs({ 'docs/auth.md': AUTH_MD, 'docs/session.md': SESSION_MD })
    coverScope()
  })

  const flag = (headingForAuth: string | null): OverlapOutcome => ({
    overlaps: [
      {
        docs: ['docs/auth.md', 'docs/session.md'],
        note: 'docs/auth.md says access tokens expire after 15 minutes; docs/session.md says 60 minutes',
        sections: [
          { doc: 'docs/auth.md', heading: headingForAuth, quote: 'every access token is minted here' },
          { doc: 'docs/session.md', heading: 'Token lifetime', quote: 'Access tokens expire after 60 minutes.' },
        ],
        review: {
          explanation: 'auth.md states 15 minutes, session.md states 60 minutes.',
          recommendation: { action: 'pick-a', rationale: 'auth.md owns tokens', confidence: 'medium' },
        },
      },
    ],
    notReached: [],
  })

  it('re-anchors a fabricated heading whose quote is verbatim in the LEAD (heading → null)', async () => {
    const { result } = await runScan({
      tagging: {
        'docs/auth.md': [{ product: 'core', concern: 'auth' }],
        'docs/session.md': [{ product: 'core', concern: 'auth' }],
      },
      // A heading the doc does not have. `check_findings` would have refused it
      // in session; this session skipped straight to the outcome, which is what
      // makes the FOLD's own re-verification load-bearing.
      overlap: async () => ({ kind: 'outcome', value: flag('Deletion Policy') }),
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.overlaps).toHaveLength(1)
    const authSide = area.overlaps[0].sections.find((s) => s.doc === 'docs/auth.md')!
    expect(authSide.heading).toBeNull()
    expect(authSide.quote).toBe('every access token is minted here')
    // The correctly-anchored side is left exactly as the session set it.
    expect(area.overlaps[0].sections).toContainEqual({
      doc: 'docs/session.md',
      heading: 'Token lifetime',
      quote: 'Access tokens expire after 60 minutes.',
    })
  })

  it('drops a pointer to a doc the session was never briefed on', async () => {
    const { result } = await runScan({
      tagging: {
        'docs/auth.md': [{ product: 'core', concern: 'auth' }],
        'docs/session.md': [{ product: 'core', concern: 'auth' }],
      },
      overlap: async () => ({
        kind: 'outcome',
        value: {
          overlaps: [
            {
              docs: ['docs/auth.md', 'docs/invented.md'],
              note: 'nope',
              sections: [{ doc: 'docs/auth.md', heading: null, quote: 'x' }],
              review: {
                explanation: 'x',
                recommendation: { action: 'dismiss', rationale: 'x', confidence: 'low' },
              },
            },
          ],
          notReached: [],
        },
      }),
    })
    expect(result.corpus.areas.find((a) => a.id === 'core/auth')!.overlaps).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// check_findings — the validator, as a unit
// ---------------------------------------------------------------------------

describe('validateOverlapFindings', () => {
  const doc = (p: string, content: string): DocCandidate => ({
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  })
  const briefed = new Map([
    ['docs/auth.md', doc('docs/auth.md', AUTH_MD)],
    ['docs/session.md', doc('docs/session.md', SESSION_MD)],
  ])
  const base = (over: Partial<OverlapOutcome['overlaps'][number]>): OverlapOutcome => ({
    overlaps: [
      {
        docs: ['docs/auth.md', 'docs/session.md'],
        note: 'n',
        sections: [{ doc: 'docs/auth.md', heading: 'Token lifetime', quote: 'Access tokens expire after 15 minutes.' }],
        review: { explanation: 'e', recommendation: { action: 'pick-a', rationale: 'r', confidence: 'low' } },
        ...over,
      },
    ],
    notReached: [],
  })

  it('accepts the empty outcome', () => {
    expect(validateOverlapFindings({ overlaps: [], notReached: [] }, briefed)).toEqual([])
  })

  it('accepts a well-anchored, verbatim-quoted finding', () => {
    expect(validateOverlapFindings(base({}), briefed)).toEqual([])
  })

  it('refuses an unbriefed doc ref', () => {
    const errors = validateOverlapFindings(base({ docs: ['docs/auth.md', 'docs/ghost.md'] }), briefed)
    expect(errors.join('\n')).toContain('`docs/ghost.md` is not one of the briefed docs')
  })

  it('refuses a section whose doc is neither of the pair', () => {
    const errors = validateOverlapFindings(
      base({ sections: [{ doc: 'docs/notes.md', heading: null, quote: 'x' }] }),
      briefed,
    )
    expect(errors.join('\n')).toContain("is not one of the overlap's two docs")
  })

  it('refuses a paraphrased quote by name', () => {
    const errors = validateOverlapFindings(
      base({ sections: [{ doc: 'docs/auth.md', heading: 'Token lifetime', quote: 'tokens live a quarter hour' }] }),
      briefed,
    )
    expect(errors.join('\n')).toContain('not verbatim')
  })

  it('refuses an unknown heading and shows the doc outline', () => {
    const errors = validateOverlapFindings(
      base({
        sections: [
          { doc: 'docs/auth.md', heading: 'Deletion Policy', quote: 'Access tokens expire after 15 minutes.' },
        ],
      }),
      briefed,
    )
    const text = errors.join('\n')
    expect(text).toContain('has no heading `Deletion Policy`')
    expect(text).toContain('Token lifetime')
  })

  it('refuses notReached naming a doc that was never briefed', () => {
    const errors = validateOverlapFindings({ overlaps: [], notReached: ['docs/ghost.md'] }, briefed)
    expect(errors.join('\n')).toContain('notReached: `docs/ghost.md` is not one of the briefed docs')
  })

  it('is the tool `check_findings` runs, and the tool reports back in one turn', async () => {
    const universe = buildScanUniverse([...briefed.values()])
    const def = overlapSessionDef({
      item: {
        areaId: 'core/auth',
        concern: 'auth',
        cluster: 0,
        docs: [briefed.get('docs/auth.md')!, briefed.get('docs/session.md')!],
        pairs: [],
        overflow: [],
      },
      universe,
    })
    const tool = def.tools.find((t) => t.name === 'check_findings')!
    const bad = await tool.execute(base({ sections: [{ doc: 'docs/auth.md', heading: 'Nope', quote: 'x' }] }), {
      workItem: '',
      signal: new AbortController().signal,
      dispatchChild: () => {
        throw new Error('not used')
      },
    })
    expect(bad.isError).toBe(true)
    expect(bad.content).toContain('problem(s)')
    // …and the structural half: the def refuses an outcome that never checked.
    expect(def.outcomePrecondition?.tool).toBe('check_findings')
  })
})

// ---------------------------------------------------------------------------
// the adjudication contract — inherited from the retired verify one-shot
// ---------------------------------------------------------------------------

describe('OVERLAP_SESSION_SYSTEM_PROMPT', () => {
  const p = OVERLAP_SESSION_SYSTEM_PROMPT

  it('spells out what is NOT a disagreement — omission, hedges, two components', () => {
    expect(p).toMatch(/OMISSION/)
    expect(p).toMatch(/Silence is never disagreement/i)
    expect(p).toMatch(/HEDGED/)
    expect(p).toMatch(/Two components/i)
    expect(p).toMatch(/Complementary coverage/i)
  })

  it('contracts the resolution brief: four actions, both values quoted, documents named', () => {
    for (const action of ['pick-a', 'pick-b', 'fix-doc', 'dismiss']) expect(p).toContain(`"${action}"`)
    expect(p).toMatch(/QUOTING both sides/i)
    expect(p).toMatch(/by its FILENAME/i)
    expect(p).toMatch(/never "doc A"\/"doc B"/i)
  })

  it('states the confidence grade and its auto-apply stakes', () => {
    expect(p).toMatch(/"low" \| "medium" \| "high"/)
    expect(p).toMatch(/APPLIED AUTOMATICALLY/)
    expect(p).toMatch(/give the LOWER/i)
    expect(p).toMatch(/"fix-doc" never auto-applies/i)
  })

  it('states the evidence discipline the fold and check_findings both enforce', () => {
    expect(p).toMatch(/verbatim/i)
    expect(p).toMatch(/25 words/)
    expect(p).toMatch(/the JSON literal `null`/)
    expect(p).toContain('check_findings')
  })

  it('states the budget contract that makes notReached honest', () => {
    expect(p).toContain('notReached')
    expect(p).toMatch(/An honest `notReached` is part of a correct outcome/i)
  })

  it('states the candidate-checklist contract: pairs are leads, unopened pairs are recorded, and no other session sees them', () => {
    expect(p).toContain('CANDIDATE COLLISIONS')
    expect(p).toMatch(/ranked leads, not verdicts/i)
    expect(p).toMatch(/recorded in the corpus as UNCHECKED/)
    expect(p).toMatch(/the ONLY one that will ever see these pairs/i)
    expect(p).toMatch(/never defer one to "another area's session"/i)
  })

  it('states the REAL budget numbers and demands batched reads (2026-08-21: a budget-blind session reads to the wall)', () => {
    expect(p).toContain(`${OVERLAP_SESSION_BUDGET.turns} turns per budget grant`)
    expect(p).toContain(`${OVERLAP_SESSION_BUDGET.maxResumes} automatic resume grants`)
    expect(p).toContain(
      `${(OVERLAP_SESSION_BUDGET.maxResumes + 1) * OVERLAP_SESSION_BUDGET.turns} turns at the absolute most`,
    )
    expect(p).toMatch(/BATCH your reads/i)
    expect(p).toMatch(/SEVERAL `read_section` calls in one message/i)
  })
})

// ---------------------------------------------------------------------------
// dedup across areas + the confidence auto-apply
// ---------------------------------------------------------------------------

describe('cross-area dedup and the confidence auto-apply', () => {
  // Both docs carry BOTH concerns, so `core/auth` and `core/billing` hold the
  // same doc pair and both sessions flag it.
  const BOTH: Tagging = {
    'docs/auth.md': [
      { product: 'core', concern: 'auth' },
      { product: 'core', concern: 'billing' },
    ],
    'docs/session.md': [
      { product: 'core', concern: 'auth' },
      { product: 'core', concern: 'billing' },
    ],
  }

  const flagWith = (confidence: 'low' | 'medium' | 'high', action: 'pick-a' | 'fix-doc'): OverlapOutcome => ({
    overlaps: [
      {
        docs: ['docs/auth.md', 'docs/session.md'],
        note: 'docs/auth.md says access tokens expire after 15 minutes; docs/session.md says 60 minutes',
        sections: [
          { doc: 'docs/auth.md', heading: 'Token lifetime', quote: 'Access tokens expire after 15 minutes.' },
          { doc: 'docs/session.md', heading: 'Token lifetime', quote: 'Access tokens expire after 60 minutes.' },
        ],
        review: {
          explanation: 'auth.md states 15 minutes; session.md states 60 minutes.',
          recommendation: { action, rationale: 'auth.md owns tokens', confidence },
        },
      },
    ],
    notReached: [],
  })

  beforeEach(() => {
    writeDocs({ 'docs/auth.md': AUTH_MD, 'docs/session.md': SESSION_MD })
    coverScope()
  })

  it('merges the same pair flagged by two areas into ONE record listing both areas', async () => {
    const { result } = await runScan({
      tagging: BOTH,
      overlap: async () => ({ kind: 'outcome', value: flagWith('medium', 'pick-a') }),
    })
    const withOverlaps = result.corpus.areas.filter((a) => a.overlaps.length > 0)
    expect(withOverlaps).toHaveLength(1)
    expect(withOverlaps[0].overlaps).toHaveLength(1)
    expect(withOverlaps[0].overlaps[0].areas.sort()).toEqual(['core/auth', 'core/billing'])
    expect(result.stats.overlapFlags).toBe(1)
  })

  it('auto-applies a HIGH-confidence pick-a into decisions.json and reports it', async () => {
    const { result } = await runScan({
      tagging: BOTH,
      overlap: async () => ({ kind: 'outcome', value: flagWith('high', 'pick-a') }),
    })
    expect(result.stats.autoResolvedConflicts).toHaveLength(1)
    expect(result.stats.autoResolvedConflicts[0]).toMatchObject({ a: 'docs/auth.md', b: 'docs/session.md', verdict: 'a' })
    const stored = readDecisions(repo)
    expect(stored.conflictResolutions).toHaveLength(1)
    expect(stored.conflictResolutions[0]).toMatchObject({ verdict: 'a', resolvedBy: 'auto' })
  })

  it('does NOT auto-apply a medium-confidence pick, nor a high-confidence fix-doc', async () => {
    const medium = await runScan({
      tagging: BOTH,
      overlap: async () => ({ kind: 'outcome', value: flagWith('medium', 'pick-a') }),
    })
    expect(medium.result.stats.autoResolvedConflicts).toEqual([])
    expect(readDecisions(repo).conflictResolutions).toEqual([])

    fs.rmSync(path.join(repo, '.truecourse'), { recursive: true, force: true })
    resetKvCacheStore()
    coverScope()
    const fixDoc = await runScan({
      tagging: BOTH,
      overlap: async () => ({ kind: 'outcome', value: flagWith('high', 'fix-doc') }),
    })
    expect(fixDoc.result.stats.autoResolvedConflicts).toEqual([])
    expect(readDecisions(repo).conflictResolutions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// briefing: the candidate checklist, and which clusters get a session at all
// ---------------------------------------------------------------------------

describe('the collision-pair checklist', () => {
  beforeEach(() => {
    writeDocs({
      'docs/auth.md': AUTH_MD,
      'docs/session.md': SESSION_MD,
      'docs/notes.md': NOTES_MD,
      'docs/solo.md': SOLO_MD,
    })
    coverScope()
  })

  const TAGGING: Tagging = {
    'docs/auth.md': [{ product: 'core', concern: 'auth' }],
    'docs/session.md': [{ product: 'core', concern: 'auth' }],
    'docs/notes.md': [{ product: 'core', concern: 'notes' }],
    'docs/solo.md': [{ product: 'core', concern: 'solo' }],
  }

  it('briefs the ranked pairs — the heading fold pulls the outside doc into the cluster — and spends nothing on pairless docs', async () => {
    const briefings = new Map<string, string>()
    const { result } = await runScan({
      tagging: TAGGING,
      overlap: async (areaId, input) => {
        briefings.set(areaId, openingOf(input))
        return { kind: 'outcome', value: { overlaps: [], notReached: [] } }
      },
    })
    // ONE cluster: `## Token lifetime` pairs auth↔session, and notes.md's
    // `## Authentication` canonicalizes to `auth` — the same fold the retired
    // widened net used, now at section level — pairing it with auth.md's H1.
    // The pair's docs share no area, so it lands in the union's first
    // (core/auth), which is where the whole connected component is judged.
    const auth = briefings.get('core/auth')!
    expect(auth).toContain('CANDIDATE COLLISIONS')
    expect(auth).toContain('docs/auth.md · Token lifetime  <->  docs/session.md · Token lifetime')
    expect(auth).toContain('docs/auth.md · Auth  <->  docs/notes.md · Authentication')
    expect(auth).toContain('--- doc: docs/auth.md')
    expect(auth).toContain('--- doc: docs/session.md')
    expect(auth).toContain('--- doc: docs/notes.md')

    // docs/solo.md shares no rare key and no canonical heading with anything:
    // it enters no pair, so it costs no session and appears in no briefing.
    expect(auth).not.toContain('docs/solo.md')
    expect([...briefings.keys()].sort()).toEqual(['core/auth'])
    expect(result.sessions.find((s) => s.kind === OVERLAP_SESSION_KIND)).toMatchObject({ ran: 1 })
  })

  it('a new canonical-heading collision mints its own cluster session', async () => {
    // `docs/solo.md` gains a `## Notes` heading, so it now pairs with
    // notes.md's H1 — a second connected component, assigned core/notes.
    writeDocs({ 'docs/solo.md': `${SOLO_MD}\n## Notes\n\nNotes live in notes.md.\n` })
    const seenAreas: string[] = []
    await runScan({
      tagging: TAGGING,
      overlap: async (areaId, input) => {
        seenAreas.push(areaId)
        if (areaId === 'core/notes') {
          expect(openingOf(input)).toContain('docs/notes.md · Notes  <->  docs/solo.md · Notes')
        }
        return { kind: 'outcome', value: { overlaps: [], notReached: [] } }
      },
    })
    expect(seenAreas.sort()).toEqual(['core/auth', 'core/notes'])
  })
})

// ---------------------------------------------------------------------------
// uncheckedPairs — pair coverage counted off the transcript, never claimed
// ---------------------------------------------------------------------------

describe('uncheckedPairs', () => {
  beforeEach(() => {
    writeDocs({ 'docs/auth.md': AUTH_MD, 'docs/session.md': SESSION_MD })
    coverScope()
  })

  const TAGGING: Tagging = {
    'docs/auth.md': [{ product: 'core', concern: 'auth' }],
    'docs/session.md': [{ product: 'core', concern: 'auth' }],
  }
  const PAIR = {
    a: { doc: 'docs/auth.md', heading: 'Token lifetime' },
    b: { doc: 'docs/session.md', heading: 'Token lifetime' },
  }

  it('a pair whose two sections were both opened is checked — nothing recorded', async () => {
    const { result } = await runScan({
      tagging: TAGGING,
      overlap: async (_areaId, input) => {
        await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        await callTool(input, 'read_section', { doc: 'docs/session.md', heading: 'Token lifetime' })
        const draft: OverlapOutcome = { overlaps: [], notReached: [] }
        await callTool(input, 'check_findings', draft)
        return { kind: 'outcome', value: draft }
      },
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.uncheckedPairs).toBeUndefined()
  })

  it('a pair with only ONE side opened lands in the corpus as unchecked — a self-report cannot clear it', async () => {
    const { result } = await runScan({
      tagging: TAGGING,
      overlap: async (_areaId, input) => {
        await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        const draft: OverlapOutcome = { overlaps: [], notReached: [] }
        await callTool(input, 'check_findings', draft)
        // The session claims full coverage; the transcript shows one side.
        return { kind: 'outcome', value: { ...draft, uncheckedPairs: [] } }
      },
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.uncheckedPairs).toHaveLength(1)
    expect(area.uncheckedPairs![0]).toMatchObject(PAIR)
    // …and it round-trips through corpus.json.
    expect(readCorpus(repo)!.areas.find((a) => a.id === 'core/auth')!.uncheckedPairs).toHaveLength(1)
  })

  it('a FAILED cluster lands every briefed pair in uncheckedPairs', async () => {
    const { result } = await runScan({
      tagging: TAGGING,
      overlap: async () => ({
        kind: 'failure',
        failure: { kind: 'budget-exhausted', notReached: 'outcome', retryability: 'none' },
      }),
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.uncheckedPairs).toHaveLength(1)
    expect(area.uncheckedPairs![0]).toMatchObject(PAIR)
  })
})

// ---------------------------------------------------------------------------
// caching — per area, invalidated by one doc edit
// ---------------------------------------------------------------------------

describe('the per-area overlap cache', () => {
  beforeEach(() => {
    writeDocs({
      'docs/auth.md': AUTH_MD,
      'docs/session.md': SESSION_MD,
      'docs/billing-a.md': '# Billing A\n\n## Invoices\n\nInvoices are issued monthly.\n',
      'docs/billing-b.md': '# Billing B\n\n## Invoices\n\nInvoices are issued weekly.\n',
    })
    coverScope()
  })

  const TAGGING: Tagging = {
    'docs/auth.md': [{ product: 'core', concern: 'auth' }],
    'docs/session.md': [{ product: 'core', concern: 'auth' }],
    'docs/billing-a.md': [{ product: 'core', concern: 'billing' }],
    'docs/billing-b.md': [{ product: 'core', concern: 'billing' }],
  }

  it('re-runs only the area whose doc changed; the untouched area hits', async () => {
    const first = await runScan({
      tagging: TAGGING,
      overlap: async () => ({ kind: 'outcome', value: { overlaps: [], notReached: [] } }),
    })
    expect(first.result.sessions.find((s) => s.kind === OVERLAP_SESSION_KIND)).toMatchObject({
      ran: 2,
      fromCache: 0,
    })

    // Edit ONE doc of ONE area. Its curate-doc key changes too (content hash),
    // so that doc re-curates; only its AREA re-runs the overlap session.
    writeDocs({ 'docs/session.md': `${SESSION_MD}\nTokens are opaque strings.\n` })
    const second = await runScan({
      tagging: TAGGING,
      overlap: async (areaId) => {
        expect(areaId).toBe('core/auth')
        return { kind: 'outcome', value: { overlaps: [], notReached: [] } }
      },
    })
    expect(second.result.sessions.find((s) => s.kind === OVERLAP_SESSION_KIND)).toMatchObject({
      ran: 1,
      fromCache: 1,
    })
  })

  /**
   * The corpus is rewritten WHOLE on every run, so a field the first run knew
   * must not silently vanish because the second run answered from cache. The
   * outcome's own `notReached` survives (it is IN the cached value); the
   * transcript-derived `sectionsOpened` is the one at risk.
   */
  it('keeps the area\'s sectionsOpened when the area answers from cache', async () => {
    const first = await runScan({
      tagging: TAGGING,
      overlap: async (areaId, input) => {
        if (areaId === 'core/auth') {
          await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        }
        return { kind: 'outcome', value: { overlaps: [], notReached: ['docs/session.md'] } }
      },
    })
    expect(first.result.corpus.areas.find((a) => a.id === 'core/auth')!.sectionsOpened).toBe(1)

    const { persistence } = memoryPersistence()
    const second = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => {
        throw new Error('every kind should be cached')
      },
      persistence,
      skipGit: true,
    })
    const area = second.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.notReached).toEqual(['docs/session.md'])
    expect(area.sectionsOpened).toBe(1)
  })

  /**
   * A cache entry written before the stamp existed is still a HIT — the field is
   * optional precisely so an old corpus does not pay a full re-scan for a signal
   * it never had. What it must NOT do is invent one: absent means "unknown until
   * this area re-keys", and a defaulted 0 would read as "the session skimmed".
   */
  it('reads a legacy entry (no sectionsOpened) as a hit, and invents no count', async () => {
    const first = await runScan({
      tagging: TAGGING,
      overlap: async (areaId, input) => {
        if (areaId === 'core/auth') {
          await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        }
        return {
          kind: 'outcome',
          value: { overlaps: [], notReached: areaId === 'core/auth' ? ['docs/session.md'] : [] },
        }
      },
    })
    expect(first.result.corpus.areas.find((a) => a.id === 'core/auth')!.sectionsOpened).toBe(1)

    // Age the entries back to the pre-stamp shape.
    expect(stripSectionsOpenedFromCache()).toBe(2)

    const { persistence } = memoryPersistence()
    const second = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => {
        throw new Error('a legacy cache entry must still be a hit')
      },
      persistence,
      skipGit: true,
    })
    expect(second.sessions.find((s) => s.kind === OVERLAP_SESSION_KIND)).toMatchObject({
      ran: 0,
      fromCache: 2,
    })
    const area = second.corpus.areas.find((a) => a.id === 'core/auth')!
    // The outcome's own fields still ride the legacy entry…
    expect(area.notReached).toEqual(['docs/session.md'])
    // …and the missing signal stays MISSING, not 0.
    expect('sectionsOpened' in area).toBe(false)
  })

  it('spends nothing at all on an unchanged repo', async () => {
    await runScan({
      tagging: TAGGING,
      overlap: async () => ({ kind: 'outcome', value: { overlaps: [], notReached: [] } }),
    })
    const { persistence } = memoryPersistence()
    const second = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => {
        throw new Error('the driver must never be resolved on a fully cached re-scan')
      },
      persistence,
      skipGit: true,
    })
    expect(second.noChanges).toBe(true)
    expect(second.sessions.every((s) => s.ran === 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// failure shapes
// ---------------------------------------------------------------------------

describe('a failed overlap session', () => {
  beforeEach(() => {
    writeDocs({ 'docs/auth.md': AUTH_MD, 'docs/session.md': SESSION_MD })
    coverScope()
  })

  const TAGGING: Tagging = {
    'docs/auth.md': [{ product: 'core', concern: 'auth' }],
    'docs/session.md': [{ product: 'core', concern: 'auth' }],
  }

  it('lands every doc of the area in notReached IN THE CORPUS, tallies, and does not abort', async () => {
    const { result } = await runScan({
      tagging: TAGGING,
      overlap: async () => ({
        kind: 'failure',
        failure: { kind: 'budget-exhausted', notReached: 'outcome', retryability: 'none' },
      }),
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.overlaps).toEqual([])
    expect(area.notReached?.sort()).toEqual(['docs/auth.md', 'docs/session.md'])
    // …and it round-trips through corpus.json, not just the in-memory result.
    const stored = readCorpus(repo)!
    expect(stored.areas.find((a) => a.id === 'core/auth')!.notReached?.sort()).toEqual([
      'docs/auth.md',
      'docs/session.md',
    ])
    expect(result.stats.llmFailures).toContainEqual(
      expect.objectContaining({ stage: OVERLAP_SESSION_KIND, attempts: 1, failures: 1 }),
    )
  })

  it('stamps sectionsOpened for the FAILED area too — "read 1 and ran out" is not "never read"', async () => {
    const { result } = await runScan({
      tagging: TAGGING,
      overlap: async (_areaId, input) => {
        await callTool(input, 'read_section', { doc: 'docs/auth.md', heading: 'Token lifetime' })
        return {
          kind: 'failure',
          failure: { kind: 'budget-exhausted', notReached: 'outcome', retryability: 'none' },
        }
      },
    })
    const area = result.corpus.areas.find((a) => a.id === 'core/auth')!
    expect(area.notReached?.sort()).toEqual(['docs/auth.md', 'docs/session.md'])
    expect(area.sectionsOpened).toBe(1)
    expect(readCorpus(repo)!.areas.find((a) => a.id === 'core/auth')!.sectionsOpened).toBe(1)
  })

  it('aborts the run BEFORE the corpus write when every overlap session dies of transport', async () => {
    // A previous corpus stands; the run must leave it byte-identical.
    const corpusFile = path.join(repo, '.truecourse', 'specs', 'corpus.json')
    fs.mkdirSync(path.dirname(corpusFile), { recursive: true })
    const sentinel = JSON.stringify({ version: 3, generatedAt: 'never', docs: [], areas: [], skippedDocs: [] })
    fs.writeFileSync(corpusFile, sentinel)

    await expect(
      runScan({
        tagging: TAGGING,
        overlap: async () => ({
          kind: 'failure',
          failure: { kind: 'transport', detail: 'provider down', class: 'provider', retryability: 'none' },
        }),
      }),
    ).rejects.toBeInstanceOf(LlmStageFailureError)

    expect(fs.readFileSync(corpusFile, 'utf-8')).toBe(sentinel)
  })

  it('names the overlap kind as the failing stage', async () => {
    const error = await runScan({
      tagging: TAGGING,
      overlap: async () => ({
        kind: 'failure',
        failure: { kind: 'transport', detail: 'provider down', class: 'provider', retryability: 'none' },
      }),
    }).catch((e: unknown) => e as LlmStageFailureError)
    expect(error).toBeInstanceOf(LlmStageFailureError)
    expect((error as LlmStageFailureError).tally.stage).toBe(OVERLAP_SESSION_KIND)
  })
})
