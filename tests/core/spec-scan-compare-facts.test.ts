/**
 * THE FACT COMPARISON — `spec-scan.compare-facts`, one session per batch of
 * recorded facts, the second half of finding conflicts by comparing facts.
 *
 * What is under test:
 * - batch planning: whole areas packed in id order up to the bound, an area
 *   over it split with its parts and cut pairs recorded, subject families
 *   joined by a rare word of their names, subject batches only for families
 *   whose facts sit in different area batches, and the order and ids within a
 *   batch;
 * - a pointer's evidence: the unit and the window of words that share the
 *   most with the fact's statement, verbatim;
 * - the gate: a fact placed twice, a fact placed nowhere, a group of one, a
 *   conflict pair outside its group, a pair that is one passage; a
 *   wrapping-up outcome is accepted with its unplaced facts stamped;
 * - the cache key moves with each named input and with nothing else;
 * - `read_context` shows a fact's passage in its document;
 * - a pointer's passage key, and the fold of findings that name the same two
 *   passages: every note kept, the recommendation as confident as the members
 *   that agree with it, the passage carried through re-anchoring;
 * - through the real `runSpecScanSessions`, from docs to corpus: a conflict
 *   folds into an overlap entry whose verbatim quotes the pointer verifier
 *   anchors where they are; a conflict inside one doc; the same conflict
 *   found by an area batch and a subject batch folds to one; several
 *   conflicts between the same two sections stay several; two fact pairs on
 *   the same two passages fold into one that keeps both notes; a failed
 *   session lands its docs in `notReached`; the checklist carries the new
 *   steps.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs'
import { KnownDisplayBlockSchema, RunRecordSchema, type DriverResult } from '../../packages/agent-loop/src/index'
import { CURATE_STEPS, curateInProcess } from '../../packages/core/src/commands/spec-in-process'
import { listStoredSessionRuns } from '../../packages/core/src/lib/sessions-store'
import { StepTracker } from '../../packages/core/src/progress'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import { SETTLE_AREAS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-areas'
import { RECORD_FACTS_SESSION_KIND, type RecordedFact } from '../../packages/core/src/services/spec-scan/record-facts'
import { SETTLE_SUBJECTS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-subjects'
import { buildCorpusConflicts, passageKey } from '../../packages/shared/src/spec/overlap-resolution.js'
import {
  COMPARE_FACTS_BUDGET,
  COMPARE_FACTS_SESSION_KIND,
  COMPARE_STAGE_VERSION,
  FOLDED_NOTE_SEPARATOR,
  POINTER_QUOTE_WORDS,
  SUBJECT_FAMILY_DF_CAP,
  checkGroups,
  compareFactsBriefing,
  compareFactsCacheKey,
  compareFactsSessionDef,
  groupsRefusal,
  evidenceWindow,
  factPointer,
  foldSamePassages,
  planCompareBatches,
  type CompareBatch,
  type CompareItem,
  type FactComparisonWire,
} from '../../packages/core/src/services/spec-scan/compare-facts'
import { instructionsFingerprint } from '../../packages/core/src/services/spec-scan/tools'
import {
  splitDocUnits,
  verifyOverlapSections,
  writeDecisions,
  type DecisionsFile,
  type DocCandidate,
} from '../../packages/spec-consolidator/src/index.js'
import { docPathOf, malformedFailure, memoryPersistence, outcome, stubDriver, type StubCall } from './spec-scan-session-stub'
import { compare, compareBriefing, record, settle, useTool, type BriefedFact, type UnitFact } from './spec-scan-facts-stub'

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

/** Facts of `body`, one per spec: the units it cites, its subject, statement and areas. */
function factsOf(
  ref: string,
  body: string,
  specs: ReadonlyArray<{ units: number[]; subject: string; statement?: string; areas: string[] }>,
): RecordedFact[] {
  const units = splitDocUnits(body)
  return specs.map((spec) => ({
    doc: ref,
    units: spec.units.map((n) => units[n - 1]!),
    subject: spec.subject,
    statement: spec.statement ?? `${spec.subject} is stated in unit ${spec.units.join(',')}.`,
    areas: spec.areas,
  }))
}

const sentences = (n: number, word: string): string => Array.from({ length: n }, (_, i) => `${word} ${i} holds.`).join('\n\n')
const ids = (batch: CompareBatch): string[] => batch.facts.map((bf) => `${bf.id} ${bf.fact.doc}#${bf.fact.units[0]!.n}`)
const bySubject = (fact: RecordedFact): string => fact.subject

// ---------------------------------------------------------------------------
// batch planning
// ---------------------------------------------------------------------------

describe('planCompareBatches', () => {
  const A = sentences(6, 'Alpha')
  const B = sentences(6, 'Beta')
  /** a/x: 3 facts (one also in a/y), a/y: 2, a/z: 4; "Export my data" in a/x and a/z. */
  const FACTS: RecordedFact[] = [
    ...factsOf('docs/a.md', A, [
      { units: [1], subject: 'Export my data', areas: ['a/x'] },
      { units: [2], subject: 'PDF export', areas: ['a/x'] },
      { units: [3], subject: 'PDF export', areas: ['a/x', 'a/y'] },
      { units: [4], subject: 'Themes', areas: ['a/y'] },
    ]),
    ...factsOf('docs/b.md', B, [
      { units: [1], subject: 'Export my data', areas: ['a/z'] },
      { units: [2], subject: 'Webhooks', areas: ['a/z'] },
      { units: [3], subject: 'Webhooks', areas: ['a/z'] },
      { units: [4], subject: 'API keys', areas: ['a/z'] },
    ]),
  ]

  it('packs whole areas in id order up to the bound, a fact of two areas counted once', () => {
    const { batches, splitAreas } = planCompareBatches(FACTS, bySubject, 5)
    const areaBatches = batches.filter((b) => b.kind === 'area')
    expect(areaBatches.map((b) => (b.kind === 'area' ? b.areas : []))).toEqual([['a/x', 'a/y'], ['a/z']])
    expect(areaBatches.map((b) => b.facts.length)).toEqual([4, 4])
    expect(splitAreas.size).toBe(0)
  })

  it('orders a batch by settled subject, then doc, then unit, and numbers it F1 on', () => {
    const [first] = planCompareBatches(FACTS, bySubject, 5).batches
    expect(ids(first!)).toEqual(['F1 docs/a.md#1', 'F2 docs/a.md#2', 'F3 docs/a.md#3', 'F4 docs/a.md#4'])
    expect(first!.facts.map((bf) => bf.subject)).toEqual(['Export my data', 'PDF export', 'PDF export', 'Themes'])
  })

  it('adds a subject batch only for a family whose facts sit in different area batches', () => {
    const plan = planCompareBatches(FACTS, bySubject, 5)
    const subjectBatches = plan.batches.filter((b) => b.kind === 'subject')
    // "Export my data" spans a/x and a/z; "PDF export" shares its rare word "export", so it comes along.
    expect(subjectBatches.map((b) => (b.kind === 'subject' ? b.subjects : []))).toEqual([['Export my data', 'PDF export']])
    expect(ids(subjectBatches[0]!)).toEqual(['F1 docs/a.md#1', 'F2 docs/b.md#1', 'F3 docs/a.md#2', 'F4 docs/a.md#3'])
    expect(plan).toMatchObject({ subjectFamilies: 1, subjectBatchFamilies: 1, subjectBatchFacts: 4 })
    // Packed into one area batch, nothing spans: no subject batch at all.
    expect(planCompareBatches(FACTS, bySubject, 20).batches.map((b) => b.kind)).toEqual(['area'])
  })

  it('joins one control named two ways in two areas into one family, and compares them together', () => {
    const builder = factsOf('docs/builder.md', sentences(4, 'Builder'), [
      { units: [1], subject: 'Download PDF button', areas: ['core/builder-layout'] },
      { units: [2], subject: 'Sidebar', areas: ['core/builder-layout'] },
      { units: [3], subject: 'Sidebar', areas: ['core/builder-layout'] },
    ])
    const exports = factsOf('docs/exports.md', sentences(4, 'Exports'), [
      { units: [1], subject: 'Download button', areas: ['core/exports'] },
      { units: [2], subject: 'Download dialog', areas: ['core/exports'] },
      { units: [3], subject: 'Export history', areas: ['core/exports'] },
    ])
    const plan = planCompareBatches([...builder, ...exports], bySubject, 3)
    expect(plan.batches.filter((b) => b.kind === 'area').map((b) => (b.kind === 'area' ? b.areas : []))).toEqual([
      ['core/builder-layout'],
      ['core/exports'],
    ])
    const [family, ...rest] = plan.batches.filter((b) => b.kind === 'subject')
    expect(rest).toEqual([])
    expect(family!.kind === 'subject' ? family!.subjects : []).toEqual(['Download button', 'Download dialog', 'Download PDF button'])
    expect(ids(family!)).toEqual(['F1 docs/exports.md#1', 'F2 docs/exports.md#2', 'F3 docs/builder.md#1'])
    expect(plan).toMatchObject({ subjectFamilies: 1, subjectBatchFamilies: 1, subjectBatchFacts: 3 })
  })

  it('joins no family by a word more subject names share than the vocabulary cap', () => {
    const many = Array.from({ length: SUBJECT_FAMILY_DF_CAP + 1 }, (_, i) => ({
      units: [i + 1],
      subject: `Panel${String.fromCharCode(97 + i)} settings`,
      areas: [i % 2 === 0 ? 'core/even' : 'core/odd'],
    }))
    const plan = planCompareBatches(factsOf('docs/settings.md', sentences(SUBJECT_FAMILY_DF_CAP + 1, 'Setting'), many), bySubject, 7)
    expect(plan.subjectFamilies).toBe(0)
    expect(plan.batches.every((b) => b.kind === 'area')).toBe(true)
  })

  it('splits an area over the bound, recording its parts and cut pairs, and compares what the cut separated by subject', () => {
    const big = factsOf(
      'docs/big.md',
      sentences(9, 'Gamma'),
      Array.from({ length: 9 }, (_, i) => ({
        units: [i + 1],
        subject: i < 5 ? 'Retention window' : 'Audit log',
        statement: i < 5 ? `The retention window is ${i + 1} days.` : `The audit log keeps entry ${i}.`,
        areas: ['a/big'],
      })),
    )
    const { batches, splitAreas } = planCompareBatches(big, bySubject, 4)
    const parts = batches.filter((b) => b.kind === 'area')
    expect(parts.every((b) => b.facts.length <= 4 && b.part?.of === 'a/big' && b.part.parts === parts.length)).toBe(true)
    expect(parts.reduce((n, b) => n + b.facts.length, 0)).toBe(9)
    const split = splitAreas.get('a/big')!
    expect(split.parts).toBe(parts.length)
    expect(split.cutPairs).toBeGreaterThan(0)
    // The five retention facts cannot fit one part of four: their subject is compared whole on its own.
    const subjectBatches = batches.filter((b) => b.kind === 'subject')
    expect(subjectBatches.flatMap((b) => (b.kind === 'subject' ? b.subjects : []))).toContain('Retention window')
    expect(planCompareBatches(big, bySubject, 4)).toEqual({
      batches,
      splitAreas,
      subjectFamilies: 0,
      subjectBatchFamilies: expect.any(Number),
      subjectBatchFacts: expect.any(Number),
    })
  })
})

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

const EXPORT_MD = `# Export

## Where

Export my data is under Settings, Account. It runs nightly.

## Formats

- PDF
- JSON
`

const PRIVACY_MD = `# Privacy

## Where

Export my data is under Settings, Danger Zone. It runs weekly.
`

/** F1 export.md#1, F2 privacy.md#1 (Export my data); F3 export.md#2, F4 privacy.md#2 (Export schedule); F5 export.md#2 again. */
function gateBatch(): CompareBatch {
  const facts = [
    ...factsOf('docs/export.md', EXPORT_MD, [
      { units: [1], subject: 'Export my data', areas: ['core/exports'] },
      { units: [2], subject: 'Export schedule', areas: ['core/exports'] },
      { units: [2], subject: 'Export schedule', statement: 'Exports run every night.', areas: ['core/exports'] },
    ]),
    ...factsOf('docs/privacy.md', PRIVACY_MD, [
      { units: [1], subject: 'Export my data', areas: ['core/exports'] },
      { units: [2], subject: 'Export schedule', areas: ['core/exports'] },
    ]),
  ]
  return planCompareBatches(facts, bySubject).batches[0]!
}

const REVIEW = {
  explanation: 'Account against Danger Zone.',
  recommendation: { action: 'fix-doc' as const, rationale: 'Neither says which is current.', confidence: 'low' as const },
}
const conflict = (a: string, b: string) => ({ a, b, note: `${a} vs ${b}`, review: REVIEW })

describe('the comparison gate', () => {
  const batch = gateBatch()

  it('knows the batch it checks', () => {
    expect(ids(batch)).toEqual([
      'F1 docs/export.md#1',
      'F2 docs/privacy.md#1',
      'F3 docs/export.md#2',
      'F4 docs/export.md#2',
      'F5 docs/privacy.md#2',
    ])
  })

  const COMPLETE: FactComparisonWire = {
    groups: [
      { subject: 'Export my data', facts: ['F1', 'F2'], verdict: 'conflict', conflicts: [conflict('F1', 'F2')] },
      { subject: 'Export schedule', facts: ['F3', 'F4', 'F5'], verdict: 'conflict', conflicts: [conflict('F3', 'F5')], consistent: ['F4'] },
    ],
    alone: [],
  }

  it('lets a complete comparison stand, its conflicts as findings with verbatim quotes', () => {
    const check = checkGroups(COMPLETE, batch)
    expect(check.problems).toEqual([])
    expect(check.unplaced).toEqual([])
    expect(groupsRefusal(check)).toBeUndefined()
    expect(check.findings[0]).toEqual({
      docs: ['docs/export.md', 'docs/privacy.md'],
      note: 'F1 vs F2',
      sections: [
        {
          doc: 'docs/export.md',
          heading: 'Where',
          quote: 'Export my data is under Settings, Account.',
          passage: passageKey('Export my data is under Settings, Account.'),
        },
        {
          doc: 'docs/privacy.md',
          heading: 'Where',
          quote: 'Export my data is under Settings, Danger Zone.',
          passage: passageKey('Export my data is under Settings, Danger Zone.'),
        },
      ],
      review: REVIEW,
    })
  })

  it('refuses a fact placed twice, and one placed nowhere', () => {
    const check = checkGroups({ ...COMPLETE, alone: ['F1'], groups: COMPLETE.groups.map((g, i) => (i === 1 ? { ...g, facts: ['F3', 'F5'], consistent: [] } : g)) }, batch)
    expect(check.problems).toEqual(['F1 is placed twice, in groups[0] and in alone; place each fact once'])
    expect(check.unplaced).toEqual(['F4'])
    expect(groupsRefusal(check)).toMatch(/^Groups refused\.\n\n1 fact\(s\) placed nowhere: F4\./)
  })

  it('refuses a group of one, and an unknown id', () => {
    const check = checkGroups(
      {
        groups: [{ subject: 'Export my data', facts: ['F1'], verdict: 'agree', conflicts: [] }],
        alone: ['F2', 'F3', 'F4', 'F5', 'F9'],
      },
      batch,
    )
    expect(check.problems).toEqual([
      'groups[0] holds one fact; a fact with no peer goes in "alone"',
      'alone names "F9", which is not a fact of this batch (F1 to F5)',
    ])
    expect(check.groups).toEqual([])
  })

  it('refuses a conflict pair outside its group, and one that is a single passage', () => {
    const check = checkGroups(
      {
        groups: [
          { subject: 'Export my data', facts: ['F1', 'F2'], verdict: 'conflict', conflicts: [conflict('F1', 'F5')], consistent: ['F2'] },
          { subject: 'Export schedule', facts: ['F3', 'F4', 'F5'], verdict: 'conflict', conflicts: [conflict('F3', 'F4')], consistent: ['F5'] },
        ],
        alone: [],
      },
      batch,
    )
    expect(check.problems).toEqual([
      'groups[0].conflicts[0] pairs F5, not in this group; a conflict is between two facts of its group',
      'groups[1].conflicts[0]: F3 and F4 are one passage of docs/export.md; a conflict is between two passages (two documents, or two places in one)',
    ])
    expect(check.findings).toEqual([])
  })

  it('refuses a conflict group that names no pair, and an agreeing group that names one', () => {
    const check = checkGroups(
      {
        groups: [
          { subject: 'Export my data', facts: ['F1', 'F2'], verdict: 'conflict', conflicts: [] },
          { subject: 'Export schedule', facts: ['F3', 'F4', 'F5'], verdict: 'agree', conflicts: [conflict('F3', 'F5')] },
        ],
        alone: [],
      },
      batch,
    )
    expect(check.problems).toEqual([
      'groups[0] is a conflict and names no pair of facts that cannot both be true',
      'groups[1] agrees and names conflicts; give it the verdict "conflict", or drop them',
    ])
    expect(check.findings).toEqual([])
  })

  it('refuses a conflict group that leaves a fact in neither a pair nor "consistent"', () => {
    // One pair standing for the whole group: F4 is in no pair and is not declared consistent.
    const bundled = checkGroups({ ...COMPLETE, groups: COMPLETE.groups.map((g) => ({ ...g, consistent: [] })) }, batch)
    expect(bundled.problems).toHaveLength(1)
    expect(bundled.problems[0]).toMatch(/^groups\[1\]: F4 is in no pair and not in "consistent"\./)
    // A fact cannot be both, and "consistent" names only the group's own facts.
    const confused = checkGroups(
      { ...COMPLETE, groups: COMPLETE.groups.map((g, i) => (i === 1 ? { ...g, consistent: ['F4', 'F3', 'F1'] } : g)) },
      batch,
    )
    expect(confused.problems).toEqual([
      'groups[1].consistent names F1, not in this group',
      'groups[1]: F3 is in a pair and in "consistent"; a fact that contradicts another is not consistent',
    ])
  })

  it('stamps the facts a wrapping-up session placed nowhere, and accepts its outcome', () => {
    const def = compareFactsSessionDef({ batch, docs: new Map() })
    const partial: FactComparisonWire = { groups: [COMPLETE.groups[0]!], alone: ['F3'] }
    const resolved = def.resolveOutcome!(partial, [])
    expect(resolved).toEqual({ ...partial, unplaced: ['F4', 'F5'] })
    const outcomeValue = def.outcomeSchema.parse(resolved)
    expect(def.validateOutcome!(outcomeValue, { wrappingUp: false })).toMatch(/F4-F5/)
    expect(def.validateOutcome!(outcomeValue, { wrappingUp: true })).toBeUndefined()
    // The model cannot write `unplaced` itself.
    expect(() => def.resolveOutcome!({ ...partial, unplaced: [] }, [])).toThrow()
  })

})

describe('a pointer\'s evidence', () => {
  it('takes the cited unit that shares the most words with the statement, not the first one', () => {
    const body = 'You can:\n\n- Export your resume as a PDF.\n- Share a public link.\n'
    const [fact] = factsOf('docs/export.md', body, [
      { units: [1, 2], subject: 'PDF export', statement: 'A resume can be exported as a PDF.', areas: ['core/exports'] },
    ])
    expect(factPointer(fact!)).toEqual({
      doc: 'docs/export.md',
      heading: null,
      quote: 'Export your resume as a PDF.',
      passage: passageKey('Export your resume as a PDF.'),
    })
  })

  it('names its passage by the whole unit it quotes, never by the unit\'s number', () => {
    const body = '## Where\n\nExport my data is under Settings, Account. It runs nightly.\n'
    const [fact] = factsOf('docs/export.md', body, [{ units: [2], subject: 'Export schedule', statement: 'Exports run nightly.', areas: ['core/exports'] }])
    expect(factPointer(fact!).passage).toBe(passageKey('It runs nightly.'))
    // An edit above the passage renumbers it and leaves its key.
    const edited = `## Intro\n\nA new first sentence.\n\n${body}`
    const [moved] = factsOf('docs/export.md', edited, [{ units: [3], subject: 'Export schedule', statement: 'Exports run nightly.', areas: ['core/exports'] }])
    expect(moved!.units[0]!.n).not.toBe(fact!.units[0]!.n)
    expect(factPointer(moved!).passage).toBe(factPointer(fact!).passage)
  })

  it('takes the window of words that shares the most with the statement, as an exact slice of the unit', () => {
    const lines = [
      '# Generated stack for local testing, with PostgreSQL and SeaweedFS beside the server.',
      'services:',
      '  app:',
      '    image: amruthpillai/reactive-resume:latest',
      '    restart: unless-stopped',
      '    environment:',
      '      - NODE_ENV=production',
      '      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/postgres',
      '      - STORAGE_URL=http://seaweedfs:8333 for uploaded pictures and exports',
      '    volumes:',
      '      - ./data:/app/data',
      '    healthcheck: { test: curl -f http://localhost:3000/api/health }',
    ]
    const body = `## Compose\n\n\`\`\`yaml\n${lines.join('\n')}\n\`\`\`\n`
    const [fact] = factsOf('docs/compose.md', body, [
      { units: [1], subject: '/app/data volume', statement: 'The example Compose file bind-mounts ./data at /app/data.', areas: ['core/self-hosting'] },
    ])
    const unit = fact!.units[0]!
    expect(unit.kind).toBe('code')
    const pointer = factPointer(fact!)
    expect(pointer.heading).toBe('Compose')
    expect(unit.text).toContain(pointer.quote)
    expect(pointer.quote).toContain('./data:/app/data')
    expect(pointer.quote.trim().split(/\s+/).length).toBeLessThanOrEqual(POINTER_QUOTE_WORDS)
    // Longer than a quote, so a window of it, and not the block's first words, which say nothing about the volume.
    expect(unit.text.split(/\s+/).length).toBeGreaterThan(POINTER_QUOTE_WORDS)
    expect(pointer.quote.startsWith('# Generated')).toBe(false)
  })

  it('is deterministic: on a tie the first unit, and the earliest window', () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    expect(evidenceWindow(words, new Set(['nothing']))).toBe(words.split(' ').slice(0, POINTER_QUOTE_WORDS).join(' '))
    expect(evidenceWindow('Short and whole.', new Set())).toBe('Short and whole.')
    const [fact] = factsOf('docs/a.md', 'First line here.\n\nSecond line here.\n', [
      { units: [1, 2], subject: 'Lines', statement: 'Nothing in common.', areas: ['core/a'] },
    ])
    expect(factPointer(fact!).quote).toBe('First line here.')
  })
})

describe('findings on the same two passages', () => {
  const at = (doc: string, quote: string) => ({ doc, heading: 'Expense list', quote, passage: passageKey(quote) })
  const api = at('docs/api.md', 'Expenses are listed 20 per page, newest first.')
  const app = at('docs/app.md', 'Expenses are listed 50 per page, oldest first.')
  const finding = (
    note: string,
    action: 'pick-a' | 'pick-b' | 'fix-doc' | 'dismiss',
    confidence: 'low' | 'medium' | 'high' | undefined,
    reversed = false,
  ) => ({
    docs: (reversed ? ['docs/app.md', 'docs/api.md'] : ['docs/api.md', 'docs/app.md']) as [string, string],
    note,
    sections: reversed ? [app, api] : [api, app],
    review: {
      explanation: `${note}, explained.`,
      recommendation: { action, rationale: `${note}, because.`, ...(confidence ? { confidence } : {}) },
    },
  })

  it('keeps every distinct note and explanation, in one order whatever order the sessions finished in', () => {
    const size = finding('page size differs', 'pick-a', 'high')
    const sort = finding('sort order differs', 'pick-a', 'medium')
    const again = finding('page size differs', 'pick-a', 'high')
    const folded = foldSamePassages([sort, size, again])
    expect(foldSamePassages([size, again, sort])).toEqual(folded)
    expect(folded.note).toBe(`page size differs${FOLDED_NOTE_SEPARATOR}sort order differs`)
    expect(folded.review.explanation).toBe('page size differs, explained. sort order differs, explained.')
    // As confident as the least confident member that agrees.
    expect(folded.review.recommendation).toEqual({ action: 'pick-a', rationale: 'page size differs, because.', confidence: 'medium' })
  })

  it('reads a member listed the other way round from the lead\'s side', () => {
    // pick-b from app.md's side is pick-a from api.md's: the two agree.
    const folded = foldSamePassages([finding('a', 'pick-a', 'high'), finding('b', 'pick-b', 'high', true)])
    expect(folded.docs).toEqual(['docs/api.md', 'docs/app.md'])
    expect(folded.review.recommendation).toMatchObject({ action: 'pick-a', confidence: 'high' })
  })

  it('never lets a high pick decide a point another member would decide the other way', () => {
    const folded = foldSamePassages([finding('a', 'pick-a', 'high'), finding('b', 'pick-b', 'high')])
    expect(folded.review.recommendation).toMatchObject({ action: 'pick-a', confidence: 'low' })
    // A member with no grade leaves the fold with none, so nothing applies it unsupervised.
    expect(foldSamePassages([finding('a', 'dismiss', 'high'), finding('b', 'dismiss', undefined)]).review.recommendation).not.toHaveProperty('confidence')
  })

  it('carries the passage through a pointer the verifier re-anchors', () => {
    const body = '# API\n\n## Paging\n\nNothing here.\n\n## Expense list\n\nExpenses are listed 20 per page, newest first.\n'
    const [moved] = verifyOverlapSections({
      docs: ['docs/api.md', 'docs/app.md'],
      note: 'page size',
      sections: [{ ...api, heading: 'Paging' }],
      bodyOf: () => body,
    })
    expect(moved).toEqual(api)
  })
})

// ---------------------------------------------------------------------------
// the cache key, and the session's tools
// ---------------------------------------------------------------------------

describe('compareFactsCacheKey', () => {
  const item = (facts: RecordedFact[], docs: DocCandidate[] = [], subjectOf = bySubject): CompareItem => ({
    batch: planCompareBatches(facts, subjectOf).batches[0]!,
    docs: new Map(docs.map((d) => [d.path, d])),
  })
  const base = (over: Partial<{ ref: string; body: string; units: number[]; subject: string; statement: string; areas: string[] }> = {}) =>
    factsOf(over.ref ?? 'docs/export.md', over.body ?? EXPORT_MD, [
      {
        units: over.units ?? [1],
        subject: over.subject ?? 'Export my data',
        statement: over.statement ?? 'Export my data is under Settings, Account.',
        areas: over.areas ?? ['core/exports'],
      },
      { units: [3], subject: 'Export formats', areas: ['core/exports'] },
    ])
  const key = (it: CompareItem, instructions: string[] = []) => compareFactsCacheKey(it, [instructionsFingerprint(instructions)])
  const KEY = key(item(base()))

  it('moves with every named input', () => {
    expect(key(item(base({ ref: 'docs/export-2.md' })))).not.toBe(KEY)
    expect(key(item(base({ units: [2] })))).not.toBe(KEY)
    expect(key(item(base({ body: EXPORT_MD.replace('Settings, Account', 'Settings, Profile') })))).not.toBe(KEY)
    expect(key(item(base({ subject: 'Data export' })))).not.toBe(KEY)
    expect(key(item(base({ statement: 'Export my data sits under Settings.' })))).not.toBe(KEY)
    expect(key(item(base({ areas: ['core/exports', 'core/privacy'] })))).not.toBe(KEY)
    expect(key(item(base()), ['be strict'])).not.toBe(KEY)
    // The settled subject is what the briefing shows, so a settlement moves it too.
    expect(key(item(base(), [], (f) => (f.subject === 'Export my data' ? 'Data export' : f.subject)))).not.toBe(KEY)
    expect(COMPARE_STAGE_VERSION).toBe(3)
  })

  it('moves with the lifecycle of a doc that has a status, never with an edit no fact cites', () => {
    const tracked = doc('docs/export.md', `---\nstatus: In Progress\n---\n\n${EXPORT_MD}`)
    const facts = base({ body: tracked.content! })
    expect(key(item(facts, [tracked]))).not.toBe(key(item(facts, [{ ...tracked, content: tracked.content!.replace('In Progress', 'Done') }])))
    // An appended section and a renamed heading change no unit a fact cites.
    const edited = EXPORT_MD.replace('## Formats', '## File formats') + '\n## Later\n\nA new sentence.\n'
    expect(key(item(base({ body: edited })))).toBe(KEY)
  })
})

describe('the comparison session', () => {
  const exportDoc = doc('docs/export.md', EXPORT_MD)
  const privacyDoc = doc('docs/privacy.md', PRIVACY_MD)
  const batch = gateBatch()
  const def = compareFactsSessionDef({ batch, docs: new Map([exportDoc, privacyDoc].map((d) => [d.path, d])) })
  const ctx = { workItem: '', signal: new AbortController().signal, dispatchChild: () => Promise.reject(new Error('unused')) }

  it('has closed tools only: the passages of its own facts, and the gate', () => {
    expect(def.computer).toBeUndefined()
    expect(def.tools.map((t) => t.name)).toEqual(['read_context', 'check_groups'])
    expect(def.outcomePrecondition?.tool).toBe('check_groups')
  })

  it('briefs each earlier conflict between its docs, quoting the passages of one that names them', () => {
    const where = (quote: string, doc: string) => ({ doc, heading: 'Where', quote, passage: passageKey(quote) })
    const keyed = {
      docs: ['docs/export.md', 'docs/privacy.md'] as [string, string],
      note: 'where',
      sections: [
        where('Export my data is under Settings, Account.', 'docs/export.md'),
        where('Export my data is under Settings, Danger Zone.', 'docs/privacy.md'),
      ],
    }
    const plain = { ...keyed, note: 'schedule', sections: keyed.sections.map(({ doc, heading, quote }) => ({ doc, heading, quote })) }
    const briefing = compareFactsBriefing({ batch, docs: new Map() }, [], [keyed, plain])
    expect(briefing).toContain(
      '  1. docs/export.md · Where · "Export my data is under Settings, Account."  <->  docs/privacy.md · Where · "Export my data is under Settings, Danger Zone."  : where',
    )
    expect(briefing).toContain('  2. docs/export.md · Where  <->  docs/privacy.md · Where  : schedule')
  })

  it('reads the section around each fact, one block per passage', async () => {
    const read = def.tools[0]!
    const result = await read.execute({ facts: ['F1', 'F3', 'F2'] }, ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('--- F1, F3 · docs/export.md · Where · lines 3-5 ---\n## Where\n\nExport my data is under Settings, Account. It runs nightly.\n--- end ---')
    expect(result.content).toContain('--- F2 · docs/privacy.md · Where')
    expect(await read.execute({ facts: ['F9'] }, ctx)).toMatchObject({ isError: true })
  })
})

// ---------------------------------------------------------------------------
// through the run
// ---------------------------------------------------------------------------

let repo: string
let decisions: DecisionsFile
beforeEach(() => {
  installMemoryKvCache()
  installMemorySessionRuns()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-compare-'))
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
})
afterEach(() => {
  resetKvCacheStore()
  resetSessionRuns()
  fs.rmSync(repo, { recursive: true, force: true })
})

function writeDocs(files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
    fs.writeFileSync(path.join(repo, rel), content)
  }
}

/** Where Export my data lives, by the words a sentence uses for it; every other sentence states nothing. */
const exportFact: UnitFact = ({ line }) =>
  /Export my data is under/.test(line) ? { subject: 'Export my data', statement: line } : null

/** Two facts conflict when both place Export my data, in different places. */
const differentPlace = (a: BriefedFact, b: BriefedFact): boolean =>
  a.statement !== b.statement && a.id < b.id && /Export my data is under/.test(a.statement)

interface ScanScript {
  tags: Record<string, Array<{ product: string; concern: string }>>
  factOf?: UnitFact
  compareWith?: (call: StubCall) => DriverResult | Promise<DriverResult>
}

function scanDriver(script: ScanScript) {
  return stubDriver(async (call) => {
    switch (call.kind) {
      case CURATE_DOC_SESSION_KIND:
        return outcome({ keep: true, reason: 'spec', areas: script.tags[docPathOf(call.briefing)] ?? [] })
      case SETTLE_AREAS_SESSION_KIND:
        return outcome({ concernMerges: [], productMerges: [], productVerdicts: [], subdivisions: [] })
      case RECORD_FACTS_SESSION_KIND:
        return record(call, script.factOf ?? exportFact)
      case SETTLE_SUBJECTS_SESSION_KIND:
        return settle(call)
      case COMPARE_FACTS_SESSION_KIND:
        return script.compareWith ? script.compareWith(call) : compare(call, differentPlace)
      default:
        throw new Error(`unscripted ${call.kind}`)
    }
  })
}

async function scan(script: ScanScript) {
  const stub = scanDriver(script)
  const facts: Array<[string, string]> = []
  const result = await runSpecScanSessions({
    repoRoot: repo,
    driver: async () => stub.driver,
    persistence: memoryPersistence().persistence,
    skipGit: true,
    conflictMethod: 'facts',
    onFact: (step, line) => facts.push([step, line]),
  })
  return { result, stub, facts }
}

const EXPORTS = { product: 'core', concern: 'exports' }
const USAGE = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, costSource: 'unpriced' as const }

describe('a scan that compares facts, from docs to corpus', () => {
  it('folds a conflict into an overlap entry whose verbatim quotes anchor where they are', async () => {
    writeDocs({ 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD })
    const { result, stub, facts } = await scan({ tags: { 'docs/export.md': [EXPORTS], 'docs/privacy.md': [EXPORTS] } })
    expect(stub.kinds.filter((k) => k === COMPARE_FACTS_SESSION_KIND)).toHaveLength(1)

    const [area] = result.corpus.areas
    expect(area!.id).toBe('core/exports')
    expect(area!.overlaps).toHaveLength(1)
    const overlap = area!.overlaps[0]!
    expect(overlap.docs).toEqual(['docs/export.md', 'docs/privacy.md'])
    expect(overlap.sections).toEqual([
      {
        doc: 'docs/export.md',
        heading: 'Where',
        quote: 'Export my data is under Settings, Account.',
        passage: passageKey('Export my data is under Settings, Account.'),
      },
      {
        doc: 'docs/privacy.md',
        heading: 'Where',
        quote: 'Export my data is under Settings, Danger Zone.',
        passage: passageKey('Export my data is under Settings, Danger Zone.'),
      },
    ])
    // Verbatim by construction, so the verifier anchors each pointer where it already is.
    const bodies: Record<string, string> = { 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD }
    for (const section of overlap.sections) expect(bodies[section.doc]).toContain(section.quote)
    expect(verifyOverlapSections({ docs: overlap.docs, note: overlap.note, sections: overlap.sections, bodyOf: (ref) => bodies[ref] })).toEqual(overlap.sections)
    expect(overlap.review?.recommendation.action).toBe('fix-doc')
    expect(result.stats.overlapFlags).toBe(1)

    expect(area!.comparison).toEqual({ facts: 2, groups: 1 })
    expect(result.corpus.comparison).toEqual({
      subjectNames: 1,
      settledSubjects: 1,
      subjectFamilies: 0,
      subjectBatchFamilies: 0,
      subjectBatchFacts: 0,
      unplacedFacts: 0,
    })
    expect(facts).toContainEqual(['compare', 'core/exports: 2 facts, 1 group, 1 conflict'])
    expect(facts).toContainEqual(['overlap', 'docs/export.md vs docs/privacy.md: docs/export.md and docs/privacy.md disagree on Export my data'])
    expect(facts).toContainEqual(['subjects', '1 subject name, nothing to settle'])
    // No skim signal and no unchecked pairs on this path.
    expect(area!.sectionsOpened).toBeUndefined()
    expect(area!.uncheckedPairs).toBeUndefined()
  })

  it('folds a conflict inside one doc, its first passage side a', async () => {
    const SETTINGS_MD = `# Settings\n\n## Account\n\nExport my data is under Settings, Account.\n\n## Danger Zone\n\nExport my data is under Settings, Danger Zone.\n`
    writeDocs({ 'docs/settings.md': SETTINGS_MD })
    const { result } = await scan({ tags: { 'docs/settings.md': [EXPORTS] } })
    const overlap = result.corpus.areas[0]!.overlaps[0]!
    expect(overlap.docs).toEqual(['docs/settings.md', 'docs/settings.md'])
    expect(overlap.sections.map((s) => s.heading)).toEqual(['Account', 'Danger Zone'])
  })

  it('folds one conflict found by an area batch and by a subject batch into one', async () => {
    const bulk = (word: string): string => `# ${word}\n\n${Array.from({ length: 200 }, (_, i) => `- ${word} setting ${i} is on.`).join('\n')}\n`
    writeDocs({
      'docs/a-bulk.md': bulk('Alpha'),
      'docs/b-bulk.md': bulk('Beta'),
      'docs/export.md': '# Export\n\nExport my data is under Settings, Account.\n',
      'docs/shared.md': '# Shared\n\nExport my data is under Settings, Danger Zone.\n',
      'docs/privacy.md': '# Privacy\n\nExport my data is under Settings, Privacy.\n',
    })
    const A = { product: 'core', concern: 'a' }
    const B = { product: 'core', concern: 'b' }
    const compared: Array<{ kind: string; ids: string[] }> = []
    const { result, facts } = await scan({
      tags: { 'docs/a-bulk.md': [A], 'docs/b-bulk.md': [B], 'docs/export.md': [A], 'docs/shared.md': [A, B], 'docs/privacy.md': [B] },
      factOf: (unit, ref) => {
        if (/Export my data is under/.test(unit.line)) return { subject: 'Export my data', statement: unit.line }
        const setting = /(Alpha|Beta) setting (\d+)/.exec(unit.line)
        return setting ? { subject: `${setting[1]} setting ${setting[2]}`, statement: `${ref}: ${unit.line}` } : null
      },
      // Only export.md against shared.md is flagged, wherever the two meet.
      compareWith: (call) => {
        const briefed = compareBriefing(call.briefing)
        compared.push({ kind: call.briefing.includes('subject batch') ? 'subject' : 'area', ids: briefed.filter((f) => f.subject === 'Export my data').map((f) => f.doc) })
        return compare(call, (a, b) => a.doc === 'docs/export.md' && b.doc === 'docs/shared.md')
      },
    })
    // The shared doc's fact sits in both area batches; only a subject batch holds all three.
    expect(compared).toEqual([
      { kind: 'area', ids: ['docs/export.md', 'docs/shared.md'] },
      { kind: 'area', ids: ['docs/privacy.md', 'docs/shared.md'] },
      { kind: 'subject', ids: ['docs/export.md', 'docs/privacy.md', 'docs/shared.md'] },
    ])
    expect(facts.filter(([step, line]) => step === 'overlap' && line.startsWith('docs/export.md vs docs/shared.md'))).toHaveLength(2)
    const overlaps = result.corpus.areas.flatMap((a) => a.overlaps)
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0]!.docs).toEqual(['docs/export.md', 'docs/shared.md'])
    expect(overlaps[0]!.areas).toEqual(['core/a'])
    // The same two passages, named once, with the one note both batches wrote.
    expect(overlaps[0]!.sections.map((s) => s.passage)).toEqual([
      passageKey('Export my data is under Settings, Account.'),
      passageKey('Export my data is under Settings, Danger Zone.'),
    ])
    expect(overlaps[0]!.note).toBe('docs/export.md and docs/shared.md disagree on Export my data')
    expect(facts).toContainEqual(['verify', 'docs/export.md vs docs/shared.md: 2 conflicts on the same two passages, folded into one'])
    expect(result.corpus.comparison).toMatchObject({ subjectBatchFamilies: 1, subjectBatchFacts: 3, unplacedFacts: 0 })
  })

  // Two docs whose "Expense list" sections disagree, sentence by sentence, on three points.
  const API_MD = `# API\n\n## Expense list\n\nThe list returns 20 expenses per page. Expenses are sorted newest first. An empty list returns an empty array.\n`
  const APP_MD = `# App\n\n## Expense list\n\nThe list shows 50 expenses per page. Expenses are sorted oldest first. An empty list shows a message.\n`
  const EXPENSES = { product: 'core', concern: 'expenses' }
  const expenseSubject = (line: string): string | null =>
    /per page/.test(line) ? 'Expense page size' : /sorted/.test(line) ? 'Expense sort order' : /empty list/i.test(line) ? 'Empty expense list' : null
  const apiAgainstApp = (call: StubCall) => compare(call, (a, b) => a.doc === 'docs/api.md' && b.doc === 'docs/app.md')

  it('files every conflict between the same two sections as an overlap of its own', async () => {
    writeDocs({ 'docs/api.md': API_MD, 'docs/app.md': APP_MD })
    const { result } = await scan({
      tags: { 'docs/api.md': [EXPENSES], 'docs/app.md': [EXPENSES] },
      factOf: ({ line }) => {
        const subject = expenseSubject(line)
        return subject ? { subject, statement: line } : null
      },
      compareWith: apiAgainstApp,
    })
    const overlaps = result.corpus.areas.flatMap((a) => a.overlaps)
    expect(overlaps).toHaveLength(3)
    expect(overlaps.every((o) => o.sections.every((s) => s.heading === 'Expense list'))).toBe(true)
    expect(new Set(overlaps.map((o) => o.sections.map((s) => s.passage).join())).size).toBe(3)
    expect(overlaps.flatMap((o) => o.sections.filter((s) => s.doc === 'docs/app.md').map((s) => s.quote)).sort()).toEqual([
      'An empty list shows a message.',
      'Expenses are sorted oldest first.',
      'The list shows 50 expenses per page.',
    ])
    expect(result.stats.overlapFlags).toBe(3)
    // Read back, they stay three conflicts, each with its own id.
    const conflicts = buildCorpusConflicts(result.corpus, {})
    expect(new Set(conflicts.map((c) => c.id)).size).toBe(3)
  })

  it('folds two fact pairs on the same two passages into one conflict that keeps both notes', async () => {
    writeDocs({
      'docs/api.md': '# API\n\n## Expense list\n\nExpenses are listed 20 per page, newest first.\n',
      'docs/app.md': '# App\n\n## Expense list\n\nExpenses are listed 50 per page, oldest first.\n',
    })
    const { result, facts } = await scan({
      tags: { 'docs/api.md': [EXPENSES], 'docs/app.md': [EXPENSES] },
      // One sentence states two facts, each a point the other doc's sentence contradicts.
      factOf: ({ line }) =>
        /listed/.test(line)
          ? [
              { subject: 'Expense page size', statement: `${line} (page size)` },
              { subject: 'Expense sort order', statement: `${line} (sort order)` },
            ]
          : null,
      compareWith: apiAgainstApp,
    })
    const overlaps = result.corpus.areas.flatMap((a) => a.overlaps)
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0]!.note).toBe(
      `docs/api.md and docs/app.md disagree on Expense page size${FOLDED_NOTE_SEPARATOR}docs/api.md and docs/app.md disagree on Expense sort order`,
    )
    expect(facts).toContainEqual(['verify', 'docs/api.md vs docs/app.md: 2 conflicts on the same two passages, folded into one'])
  })

  it('lands a failed comparison\'s docs in their areas\' notReached', async () => {
    writeDocs({ 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD })
    const { result, facts } = await scan({
      tags: { 'docs/export.md': [EXPORTS], 'docs/privacy.md': [EXPORTS] },
      compareWith: () => malformedFailure(),
    })
    const [area] = result.corpus.areas
    expect(area!.notReached).toEqual(['docs/export.md', 'docs/privacy.md'])
    expect(area!.overlaps).toEqual([])
    expect(area!.comparison).toEqual({ facts: 0, groups: 0 })
    expect(facts).toContainEqual(['compare', 'core/exports: session failed, its 2 facts from 2 docs left uncompared'])
    expect(result.stats.llmFailures).toEqual([expect.objectContaining({ stage: COMPARE_FACTS_SESSION_KIND, failures: 1 })])
  })

  it('counts the facts a wrapping-up comparison left unplaced', async () => {
    writeDocs({ 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD })
    const { result } = await scan({
      tags: { 'docs/export.md': [EXPORTS], 'docs/privacy.md': [EXPORTS] },
      // The session spends its whole budget, checks, and answers in the wrap-up
      // with one of its two facts placed.
      compareWith: async (call) => {
        const turns = COMPARE_FACTS_BUDGET.turns * (COMPARE_FACTS_BUDGET.maxResumes + 1)
        for (let i = 0; i < turns; i++) await call.emit({ type: 'assistant-turn', text: 'grouping', usage: USAGE })
        await useTool(call, 'check_groups', { groups: [], alone: ['F1'] })
        return outcome({ groups: [], alone: ['F1'] })
      },
    })
    // The wrap-up accepts it, and the fold counts the fact left out.
    expect(result.corpus.comparison).toMatchObject({ unplacedFacts: 1 })
    expect(result.corpus.areas[0]!.comparison).toEqual({ facts: 2, groups: 0 })
  })

  it('serves every batch from the cache on an unchanged re-run', async () => {
    writeDocs({ 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD })
    const tags = { 'docs/export.md': [EXPORTS], 'docs/privacy.md': [EXPORTS] }
    await scan({ tags })
    const { result, stub, facts } = await scan({ tags })
    expect(stub.kinds).toEqual([])
    expect(result.noChanges).toBe(true)
    expect(result.corpus.areas[0]!.overlaps).toHaveLength(1)
    expect(facts).toContainEqual(['compare', 'core/exports: 2 facts, 1 group, 1 conflict, from cache'])
  })

  it('checks off recording, settling subjects and comparing facts, each step with its sessions', async () => {
    writeDocs({ 'docs/export.md': EXPORT_MD, 'docs/privacy.md': PRIVACY_MD })
    let steps: ReadonlyArray<{ key: string; label: string; status: string; detail?: string; facts?: string[] }> = []
    const tracker = new StepTracker((payload) => {
      if (payload.steps) steps = payload.steps
    }, [...CURATE_STEPS])
    await curateInProcess(repo, {
      skipGit: true,
      skipCorpusWrite: true,
      tracker,
      driver: scanDriver({ tags: { 'docs/export.md': [EXPORTS], 'docs/privacy.md': [EXPORTS] } }).driver,
      transportMode: 'api',
      decisions,
      conflictMethod: 'facts',
    })
    expect(steps.map((s) => [s.key, s.label, s.status])).toEqual([
      ['discover', 'Discovering docs', 'done'],
      ['tag', 'Tagging doc areas', 'done'],
      ['record', 'Recording facts', 'done'],
      ['subjects', 'Settling subjects', 'done'],
      ['compare', 'Comparing facts', 'done'],
      ['overlap', 'Flagging overlaps', 'done'],
      ['verify', 'Verifying conflicts', 'done'],
    ])
    const step = (key: string) => steps.find((s) => s.key === key)!
    expect(step('subjects').detail).toBe('1 name · 1 subject')
    expect(step('compare').facts).toEqual(['core/exports: 2 facts, 1 group, 1 conflict'])
    expect(step('overlap').facts).toEqual(['docs/export.md vs docs/privacy.md: docs/export.md and docs/privacy.md disagree on Export my data'])

    const [stored] = await listStoredSessionRuns(repo, 'spec-scan')
    const block = KnownDisplayBlockSchema.parse(RunRecordSchema.parse(stored).display?.blocks[0])
    if (block.kind !== 'checklist') throw new Error('the run stamped no checklist block')
    expect(block.items.map((item) => [item.key, item.sessionKinds])).toEqual([
      ['discover', ['spec-scan.orchestrate']],
      ['tag', ['spec-scan.curate-doc', 'spec-scan.settle-areas']],
      ['record', [RECORD_FACTS_SESSION_KIND]],
      ['subjects', [SETTLE_SUBJECTS_SESSION_KIND]],
      ['compare', [COMPARE_FACTS_SESSION_KIND]],
      ['overlap', []],
      ['verify', []],
    ])
  })
})
