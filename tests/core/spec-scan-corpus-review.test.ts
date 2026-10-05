/**
 * THE CORPUS REVIEW — `spec-scan.corpus-review`, the whole-corpus check after
 * per-doc curation on a driver that can hand a session a computer.
 *
 * Under test: the fold applies the review's drops as skipped docs with their
 * category and reason, a pinned doc is never dropped, a restatement whose
 * sources all leave stays, the in-session check refuses a drop it cannot
 * stand behind, and the cache key moves with exactly its named inputs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import {
  CORPUS_REVIEW_SESSION_KIND,
  applyCorpusReview,
  corpusReviewCacheKey,
  validateCorpusReview,
  type CorpusReviewOutcome,
} from '../../packages/core/src/services/spec-scan/corpus-review'
import { corpusFingerprint } from '../../packages/core/src/services/spec-scan/corpus-dir'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { instructionsFingerprint } from '../../packages/core/src/services/spec-scan/tools'
import { writeDecisions, type DecisionsFile, type DocCandidate } from '../../packages/spec-consolidator/src/index.js'
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionPersistence,
  SessionRunInput,
} from '../../packages/agent-loop/src/index'

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const briefedDoc = (input: SessionRunInput): string =>
  /^PATH \(repo-relative\): (.+)$/m.exec(input.initialMessages.at(-1) ?? '')?.[1] ?? ''

function scriptedDriver(script: (kind: string, input: SessionRunInput) => DriverResult): SessionDriver {
  return {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content })
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
      events.set(sessionId, [...(events.get(sessionId) ?? []), event])
    },
    updateIndex() {},
    readEvents: (sessionId) => events.get(sessionId) ?? [],
  }
}

let repo: string
beforeEach(() => {
  installMemoryKvCache()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-review-'))
  const files: Record<string, string> = {
    'docs/guide.md': '# Guide\n\nExport my data is under Settings, Account.\n',
    'docs/vs-other.md': '# Us vs Other\n\nYou can export your data from Settings.\n',
    'docs/plan.md': '# Plugin plan (historical)\n\nWe will build plugins with a sandbox.\n',
  }
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), content)
  }
})
afterEach(() => {
  resetKvCacheStore()
  fs.rmSync(repo, { recursive: true, force: true })
})

function decide(manualIncludes: string[] = []): void {
  const decisions: DecisionsFile = {
    version: 2,
    manualIncludes,
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
}

const DROPS: CorpusReviewOutcome = {
  drops: [
    { ref: 'docs/vs-other.md', category: 'derivative', reason: 'It only restates the guide.', restates: ['docs/guide.md'] },
    { ref: 'docs/plan.md', category: 'historical', reason: 'It labels itself a historical plan.', restates: [] },
  ],
}

async function scan(review: CorpusReviewOutcome, computer = true) {
  const reviewed: string[] = []
  const driver = scriptedDriver((kind, input) => {
    if (kind === CURATE_DOC_SESSION_KIND) {
      return { kind: 'outcome', value: { keep: true, reason: `spec ${briefedDoc(input)}`, areas: [{ product: 'core', concern: 'data' }] } }
    }
    if (kind === CORPUS_REVIEW_SESSION_KIND) {
      reviewed.push(input.initialMessages.at(-1) ?? '')
      return { kind: 'outcome', value: review }
    }
    if (kind === SETTLE_AREAS_SESSION_KIND) {
      return { kind: 'outcome', value: { concernMerges: [], productMerges: [], productVerdicts: [], subdivisions: [] } }
    }
    // Overlap detection is off: no hunt or cluster session runs.
    throw new Error(`unscripted session kind: ${kind}`)
  })
  const result = await runSpecScanSessions({
    repoRoot: repo,
    driver: async () => driver,
    persistence: memoryPersistence(),
    skipGit: true,
    disableOverlapDetection: true,
    ...(computer ? { computer: true } : {}),
  })
  return { result, reviewed }
}

// ---------------------------------------------------------------------------
// the fold
// ---------------------------------------------------------------------------

describe('the corpus review in the run', () => {
  it('drops what it names as skipped docs, with category and reason, and keeps the rest', async () => {
    decide()
    const { result, reviewed } = await scan(DROPS)
    expect(reviewed).toHaveLength(1)
    expect(reviewed[0]).toContain('docs/vs-other.md')
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/guide.md'])
    expect(result.corpus.skippedDocs).toEqual(
      expect.arrayContaining([
        { ref: 'docs/vs-other.md', category: 'derivative', reason: 'It only restates the guide. (restates docs/guide.md)' },
        { ref: 'docs/plan.md', category: 'historical', reason: 'It labels itself a historical plan.' },
      ]),
    )
  })

  it('never drops a doc the user force-included', async () => {
    decide(['docs/plan.md'])
    const { result } = await scan(DROPS)
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual(['docs/guide.md', 'docs/plan.md'])
  })

  it('does not run without a computer', async () => {
    decide()
    const { result, reviewed } = await scan(DROPS, false)
    expect(reviewed).toEqual([])
    expect(result.corpus.docs).toHaveLength(3)
  })
})

describe('applyCorpusReview', () => {
  const kept = new Set(['a.md', 'b.md', 'c.md'])

  it('keeps one of two docs named as restating each other, never neither', () => {
    const applied = applyCorpusReview(
      [
        {
          drops: [
            { ref: 'a.md', category: 'derivative', reason: 'restates b', restates: ['b.md'] },
            { ref: 'b.md', category: 'duplicate', reason: 'copy of a', restates: ['a.md'] },
          ],
        },
      ],
      kept,
      new Set(),
    )
    expect(applied.drops.map((d) => d.ref)).toEqual(['b.md'])
    expect(applied.declined.map((d) => d.ref)).toEqual(['a.md'])
  })

  it('keeps a restatement whose only source is dropped for another reason', () => {
    const applied = applyCorpusReview(
      [{ drops: [
        { ref: 'a.md', category: 'derivative', reason: 'restates b', restates: ['b.md'] },
        { ref: 'b.md', category: 'historical', reason: 'a plan', restates: [] },
      ] }],
      kept,
      new Set(),
    )
    expect(applied.drops.map((d) => d.ref)).toEqual(['b.md'])
    expect(applied.declined).toEqual([{ ref: 'a.md', why: 'none of the docs it restates stays in the corpus' }])
  })

  it('drops a restatement whose source stays, and ignores refs that are not kept', () => {
    const applied = applyCorpusReview(
      [{ drops: [
        { ref: 'a.md', category: 'derivative', reason: 'restates c', restates: ['c.md'] },
        { ref: 'z.md', category: 'process', reason: 'not kept', restates: [] },
      ] }],
      kept,
      new Set(),
    )
    expect(applied.drops.map((d) => d.ref)).toEqual(['a.md'])
  })
})

describe('validateCorpusReview', () => {
  it('refuses a drop outside the shard, a doubled ref, and a restatement naming nothing kept', () => {
    const errors = validateCorpusReview(
      {
        drops: [
          { ref: 'x.md', category: 'process', reason: 'r', restates: [] },
          { ref: 'a.md', category: 'derivative', reason: 'r', restates: [] },
          { ref: 'a.md', category: 'duplicate', reason: 'r', restates: ['gone.md'] },
        ],
      },
      new Set(['a.md']),
      new Set(['a.md', 'b.md']),
    )
    expect(errors).toHaveLength(4)
  })
})

describe('corpusReviewCacheKey', () => {
  const doc = (ref: string, contentHash: string): DocCandidate => ({
    path: ref,
    absPath: '',
    content: '# x\n',
    kind: 'spec',
    preview: '',
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash,
    size: 4,
  })
  const a = doc('a.md', 'ha')
  const b = doc('b.md', 'hb')
  const base = corpusReviewCacheKey({ index: 1, docs: [a, b] }, corpusFingerprint([a, b]), [instructionsFingerprint([])])

  it('moves with a kept doc, the kept set and the instructions, and nothing else', () => {
    const edited = doc('a.md', 'ha2')
    expect(corpusReviewCacheKey({ index: 1, docs: [edited, b] }, corpusFingerprint([edited, b]), [instructionsFingerprint([])])).not.toBe(base)
    const c = doc('c.md', 'hc')
    expect(corpusReviewCacheKey({ index: 1, docs: [a, b] }, corpusFingerprint([a, b, c]), [instructionsFingerprint([])])).not.toBe(base)
    expect(corpusReviewCacheKey({ index: 1, docs: [a, b] }, corpusFingerprint([a, b]), [instructionsFingerprint(['x'])])).not.toBe(base)
    expect(corpusReviewCacheKey({ index: 3, docs: [b, a] }, corpusFingerprint([b, a]), [instructionsFingerprint([])])).toBe(base)
  })
})
