/**
 * THE AREA SETTLING SESSION — `spec-scan.settle-areas`, at most one per corpus.
 * Three things carry the design: the deterministic GATE that
 * spends zero sessions on an already-settled vocabulary, the VALIDATOR that
 * refuses an incomplete settlement (in-session and again in the fold), and the
 * fold that turns a settlement into the grouper's vocab map.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetKvCacheStore } from '@truecourse/llm'
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run'
import { CURATE_DOC_SESSION_KIND } from '../../packages/core/src/services/spec-scan/curate-doc'
import {
  BRIEFED_DOCS_PER_LABEL_MAX,
  FRAGMENTED_CONCERNS_MIN,
  SETTLE_AREAS_SESSION_KIND,
  SUBDIVISION_DOC_THRESHOLD,
  applySettlement,
  collectAreaVocab,
  nearNameCandidates,
  settleAreasBriefing,
  settleAreasCacheKey,
  settleAreasGate,
  settleAreasSessionDef,
  validateSettlement,
  type AreaSettlement,
} from '../../packages/core/src/services/spec-scan/settle-areas'
import { buildScanUniverse } from '../../packages/core/src/services/spec-scan/tools'
import type {
  AreaTag,
  DecisionsFile,
  DocCandidate,
  RepoIdentity,
} from '../../packages/spec-consolidator/src/index.js'
import {
  docPathOf,
  memoryPersistence,
  outcome,
  stubDriver,
  toolResult,
  type StubCall,
} from './spec-scan-session-stub'

// ---------------------------------------------------------------------------
// the gate + the vocabulary view (pure)
// ---------------------------------------------------------------------------

const tagMap = (rows: Record<string, [string, string][]>): Map<string, AreaTag[]> =>
  new Map(
    Object.entries(rows).map(([ref, tags]) => [
      ref,
      tags.map(([product, concern]) => ({ product, concern })),
    ]),
  )

/** A doc universe from `ref → first heading`, for the briefing's titles. */
const universeOf = (titles: Record<string, string>) =>
  buildScanUniverse(
    Object.entries(titles).map(
      ([path, title]): DocCandidate => ({
        path,
        absPath: `/repo/${path}`,
        kind: 'spec',
        preview: `# ${title}\n`,
        lastTouched: '2026-01-01T00:00:00.000Z',
      }),
    ),
  )

describe('settleAreasGate — when a settlement is worth a session', () => {
  it('one core product and one concern settles nothing: no session', () => {
    const vocab = collectAreaVocab(tagMap({ 'a.md': [['core', 'auth']], 'b.md': [['core', 'auth']] }))
    expect(vocab.products.size).toBe(0)
    expect([...vocab.concerns.keys()]).toEqual(['auth'])
    expect(settleAreasGate(vocab)).toBe(false)
  })

  // THE REFERENCE REGRESSION: one axis, one concern — but the product axis is
  // claimed by something that is not core, and that claim needs a verdict.
  it('a single non-core product on a single-concern corpus still opens a session', () => {
    const vocab = collectAreaVocab(tagMap({ 'a.md': [['booking', 'auth']], 'b.md': [['booking', 'auth']] }))
    expect([...vocab.products.keys()]).toEqual(['booking'])
    expect([...vocab.concerns.keys()]).toEqual(['auth'])
    expect(settleAreasGate(vocab)).toBe(true)
  })

  it('two concerns on one core product open a session', () => {
    const vocab = collectAreaVocab(tagMap({ 'a.md': [['core', 'auth']], 'b.md': [['core', 'billing']] }))
    expect(settleAreasGate(vocab)).toBe(true)
  })

  it('an oversized concern opens a session and is briefed as a subdivision candidate', () => {
    const rows: Record<string, [string, string][]> = {}
    for (let i = 0; i <= SUBDIVISION_DOC_THRESHOLD; i += 1) rows[`docs/d${i}.md`] = [['core', 'endpoints']]
    const vocab = collectAreaVocab(tagMap(rows))

    expect(vocab.concerns.size).toBe(1)
    expect(vocab.products.size).toBe(0)
    expect(vocab.overThreshold).toEqual(['endpoints'])
    expect(settleAreasGate(vocab)).toBe(true)

    const briefing = settleAreasBriefing(vocab, buildScanUniverse([]))
    expect(briefing).toContain(`Oversized concerns (over ${SUBDIVISION_DOC_THRESHOLD} docs)`)
    expect(briefing).toMatch(/^ {2}endpoints$/m)
  })

  it('process-only tags never claim the product axis', () => {
    const vocab = collectAreaVocab(tagMap({ 'a.md': [['process', 'goals']], 'b.md': [['core', 'auth']] }))
    expect([...vocab.products.keys()]).toEqual([])
    expect([...vocab.concerns.keys()]).toEqual(['auth'])
  })
})

// ---------------------------------------------------------------------------
// the briefing carries the label→docs map (the defect: a 45-concern vocabulary
// spent all 16 turns enumerating `docs_with_label` and never settled anything)
// ---------------------------------------------------------------------------

describe('settleAreasBriefing — the label→docs map rides the briefing', () => {
  const vocab = collectAreaVocab(
    tagMap({
      'docs/booking-auth.md': [['booking', 'auth']],
      'docs/core-auth.md': [['core', 'auth']],
      'docs/billing.md': [['core', 'billing']],
    }),
  )
  const universe = universeOf({
    'docs/booking-auth.md': 'Booking auth',
    'docs/core-auth.md': 'Auth',
    'docs/billing.md': 'Billing',
  })

  it('names every doc of every concern, with its title', () => {
    const briefing = settleAreasBriefing(vocab, universe)
    expect(briefing).toContain('docs/booking-auth.md  ·  Booking auth')
    expect(briefing).toContain('docs/core-auth.md  ·  Auth')
    expect(briefing).toContain('docs/billing.md  ·  Billing')
    // The counts stay, as the label header.
    expect(briefing).toMatch(/^ {2}auth {2}\(2 docs\)$/m)
    expect(briefing).toMatch(/^ {2}billing {2}\(1 doc\)$/m)
  })

  it('names every doc of every non-core product too', () => {
    const briefing = settleAreasBriefing(vocab, universe)
    const products = briefing.slice(briefing.indexOf('Non-core products'), briefing.indexOf('Concerns ('))
    expect(products).toContain('docs/booking-auth.md  ·  Booking auth')
  })

  it('says the map is complete, so no session goes label-by-label for it', () => {
    expect(settleAreasBriefing(vocab, universe)).toContain('the whole label→docs map')
  })

  it('a doc missing from the universe still gets its ref listed', () => {
    expect(settleAreasBriefing(vocab, buildScanUniverse([]))).toContain('docs/billing.md')
  })

  it('caps a pathological label list and says how many it withheld', () => {
    const rows: Record<string, [string, string][]> = {}
    for (let i = 0; i < BRIEFED_DOCS_PER_LABEL_MAX + 7; i += 1) {
      rows[`docs/d${String(i).padStart(2, '0')}.md`] = [['core', 'endpoints']]
    }
    const big = collectAreaVocab(tagMap(rows))
    const briefing = settleAreasBriefing(big, buildScanUniverse([]))

    expect(briefing).toContain('docs/d00.md')
    expect(briefing).not.toContain(`docs/d${String(BRIEFED_DOCS_PER_LABEL_MAX).padStart(2, '0')}.md`)
    expect(briefing).toContain(`… and 7 more — \`docs_with_label\` lists all ${BRIEFED_DOCS_PER_LABEL_MAX + 7}.`)
  })

  it('shrinks the per-label list further as the vocabulary grows', () => {
    const rows: Record<string, [string, string][]> = {}
    for (let label = 0; label < 300; label += 1) {
      for (let doc = 0; doc < 5; doc += 1) rows[`docs/c${label}-d${doc}.md`] = [['core', `concern-${label}`]]
    }
    const huge = collectAreaVocab(tagMap(rows))
    const briefing = settleAreasBriefing(huge, buildScanUniverse([]))

    expect(huge.concerns.size).toBe(300)
    // Every label is still named; the doc lists are what gives.
    expect(briefing).toContain('concern-299')
    expect(briefing).toContain('more — `docs_with_label` lists all 5.')
    expect(briefing.length).toBeLessThan(120_000)
  })
})

// ---------------------------------------------------------------------------
// the validator (`check_settlement` in-session, re-run in the fold)
// ---------------------------------------------------------------------------

describe('validateSettlement', () => {
  const vocab = collectAreaVocab(
    tagMap({
      'a.md': [['booking', 'endpoints']],
      'b.md': [['booking', 'endpoints']],
      'c.md': [['core', 'billing']],
    }),
  )
  const base: AreaSettlement = {
    concernMerges: {},
    productMerges: {},
    productVerdicts: [{ product: 'booking', verdict: 'justified', reason: 'a separate app' }],
    subdivisions: [],
  }

  it('accepts a complete settlement', () => {
    expect(validateSettlement(base, vocab)).toEqual([])
  })

  it('names a non-core product left without a verdict', () => {
    const errors = validateSettlement({ ...base, productVerdicts: [] }, vocab)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('`booking`')
    expect(errors[0]).toContain('missing a verdict')
  })

  it('refuses a merge target that is not a label of this corpus', () => {
    expect(validateSettlement({ ...base, concernMerges: { endpoints: 'routes' } }, vocab)).toEqual([
      expect.stringContaining('target `routes`'),
    ])
    // …and a source label that is not one either.
    expect(validateSettlement({ ...base, concernMerges: { nope: 'endpoints' } }, vocab)).toEqual([
      expect.stringContaining('`nope` is not a concern label'),
    ])
  })

  it('lets a product merge onto core, and refuses one onto process', () => {
    expect(validateSettlement({ ...base, productMerges: { booking: 'core' } }, vocab)).toEqual([])
    expect(validateSettlement({ ...base, productMerges: { booking: 'process' } }, vocab)).toContainEqual(
      expect.stringContaining('may never map to `process`'),
    )
  })

  it('demands every doc of a subdivided label, and only its docs, and only into targets', () => {
    const sub = (assignments: Record<string, string>): AreaSettlement => ({
      ...base,
      subdivisions: [{ label: 'endpoints', into: ['endpoint reads', 'endpoint writes'], assignments }],
    })

    const missing = validateSettlement(sub({ 'a.md': 'endpoint reads' }), vocab)
    expect(missing).toEqual([expect.stringContaining('`b.md`')])
    expect(missing[0]).toContain('unassigned')

    expect(
      validateSettlement(sub({ 'a.md': 'endpoint reads', 'b.md': 'endpoint writes' }), vocab),
    ).toEqual([])

    const wrongTarget = validateSettlement(
      sub({ 'a.md': 'endpoint reads', 'b.md': 'somewhere else' }),
      vocab,
    )
    // The doc IS named, just at a target that does not exist — the specific
    // error, not the generic "unassigned" one.
    expect(wrongTarget).toEqual([
      expect.stringContaining('assigned to `somewhere else`, not one of `into`'),
    ])

    const foreignDoc = validateSettlement(
      sub({ 'a.md': 'endpoint reads', 'b.md': 'endpoint writes', 'c.md': 'endpoint reads' }),
      vocab,
    )
    expect(foreignDoc).toEqual([expect.stringContaining('`c.md` does not carry the label')])
  })
})

describe('applySettlement — lenient where the validator is strict', () => {
  const vocab = collectAreaVocab(
    tagMap({
      'a.md': [['booking', 'endpoints']],
      'b.md': [['booking', 'endpoints']],
      'c.md': [['core', 'billing']],
    }),
  )

  it('folds a collapse-to-core verdict into the product merge map', () => {
    const applied = applySettlement(
      {
        concernMerges: {},
        productMerges: {},
        productVerdicts: [{ product: 'booking', verdict: 'collapse-to-core', reason: 'a feature' }],
        subdivisions: [],
      },
      vocab,
    )
    expect(applied.vocab.products).toEqual({ booking: 'core' })
  })

  it('drops the invalid parts of a settlement instead of refusing it whole', () => {
    const applied = applySettlement(
      {
        concernMerges: { endpoints: 'invented', billing: 'endpoints' },
        productMerges: { ghost: 'core' },
        productVerdicts: [{ product: 'booking', verdict: 'justified', reason: 'kept' }],
        subdivisions: [
          {
            label: 'endpoints',
            into: ['endpoint reads', 'endpoint writes'],
            // `zz.md` is not in this corpus and `nope` is not an `into` target.
            assignments: { 'a.md': 'endpoint reads', 'b.md': 'nope', 'zz.md': 'endpoint writes' },
          },
        ],
      },
      vocab,
    )
    expect(applied.vocab.concerns).toEqual({ billing: 'endpoints' })
    expect(applied.vocab.products).toEqual({})
    expect([...applied.reassignments.keys()].sort()).toEqual(['a.md', 'zz.md'])
    expect(applied.reassignments.get('a.md')).toEqual(new Map([['endpoints', 'endpoint reads']]))
  })

  it('compresses merge chains — the grouper applies the map ONE hop deep', () => {
    // Labels chosen clear of CONCERN_ALIASES/PRODUCT_ALIASES, so all three
    // survive canonicalization as distinct concerns.
    const chained = collectAreaVocab(
      tagMap({
        'a.md': [['core', 'slots']],
        'b.md': [['core', 'slot-holds']],
        'c.md': [['core', 'slot-reservations']],
        'd.md': [['widgets', 'billing']],
        'e.md': [['gadgets', 'billing']],
      }),
    )
    const applied = applySettlement(
      {
        // slot-reservations → slot-holds → slots must land … on slots.
        concernMerges: { 'slot-reservations': 'slot-holds', 'slot-holds': 'slots' },
        // widgets → gadgets, and gadgets collapses to core: widgets lands on core.
        productMerges: { widgets: 'gadgets' },
        productVerdicts: [
          { product: 'widgets', verdict: 'justified', reason: 'merged away' },
          { product: 'gadgets', verdict: 'collapse-to-core', reason: 'a feature' },
        ],
        subdivisions: [],
      },
      chained,
    )
    expect(applied.vocab.concerns).toEqual({ 'slot-reservations': 'slots', 'slot-holds': 'slots' })
    expect(applied.vocab.products).toEqual({ widgets: 'core', gadgets: 'core' })
  })

  it('resolves a merge cycle to its smallest label instead of leaving it unapplied', () => {
    const cyclic = collectAreaVocab(
      tagMap({
        'a.md': [['core', 'slots']],
        'b.md': [['core', 'slot-holds']],
      }),
    )
    const applied = applySettlement(
      {
        concernMerges: { slots: 'slot-holds', 'slot-holds': 'slots' },
        productMerges: {},
        productVerdicts: [],
        subdivisions: [],
      },
      cyclic,
    )
    expect(applied.vocab.concerns).toEqual({ slots: 'slot-holds' })
  })
})

describe('the settle session definition', () => {
  it('demands `check_settlement` before an outcome is accepted', () => {
    const vocab = collectAreaVocab(tagMap({ 'a.md': [['booking', 'endpoints']] }))
    const def = settleAreasSessionDef({ vocab, universe: buildScanUniverse([]) })
    expect(def.kind).toBe(SETTLE_AREAS_SESSION_KIND)
    expect(def.outcomePrecondition?.tool).toBe('check_settlement')
    expect(def.tools.map((t) => t.name).sort()).toEqual(['check_settlement', 'docs_with_label', 'read_doc'])
  })

  // The key covers everything the briefing SAYS. Since the briefing carries the
  // label→docs map, the docs behind a label are part of the key — a corpus that
  // gained, lost or re-tagged a doc briefs differently and settles again.
  it('keys the cache on the label→docs map the briefing carries', () => {
    const one = collectAreaVocab(tagMap({ 'a.md': [['booking', 'endpoints']] }))
    const sameLabelsMoreDocs = collectAreaVocab(
      tagMap({ 'a.md': [['booking', 'endpoints']], 'b.md': [['booking', 'endpoints']] }),
    )
    const sameLabelsOtherDocs = collectAreaVocab(tagMap({ 'z.md': [['booking', 'endpoints']] }))
    const different = collectAreaVocab(tagMap({ 'a.md': [['booking', 'billing']] }))

    expect(settleAreasCacheKey(sameLabelsMoreDocs)).not.toBe(settleAreasCacheKey(one))
    expect(settleAreasCacheKey(sameLabelsOtherDocs)).not.toBe(settleAreasCacheKey(one))
    expect(settleAreasCacheKey(different)).not.toBe(settleAreasCacheKey(one))
    // Identical vocabulary, identical key — the doc ORDER is not information.
    expect(
      settleAreasCacheKey(
        collectAreaVocab(tagMap({ 'b.md': [['booking', 'endpoints']], 'a.md': [['booking', 'endpoints']] })),
      ),
    ).toBe(settleAreasCacheKey(sameLabelsMoreDocs))
    // The instructions tail (step 6) moves it too.
    expect(settleAreasCacheKey(one, ['fp'])).not.toBe(settleAreasCacheKey(one))
  })
})

// ---------------------------------------------------------------------------
// the empty-draft pushback (the 2026-08-20 reference runs: sessions sent an
// empty draft on turn 1, read nothing, and the checker blessed it)
// ---------------------------------------------------------------------------

describe('check_settlement — one pushback on a no-op draft over a fragmented vocabulary', () => {
  const EMPTY: AreaSettlement = { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] }

  /** A fragmented single-doc-per-concern vocabulary of `n` concerns. */
  const fragmented = (n: number) => {
    const rows: Record<string, [string, string][]> = {}
    for (let i = 0; i < n; i += 1) rows[`docs/d${i}.md`] = [['core', `topic-${i}`]]
    return collectAreaVocab(tagMap(rows))
  }

  const checkTool = (vocab: ReturnType<typeof collectAreaVocab>) => {
    const def = settleAreasSessionDef({ vocab, universe: buildScanUniverse([]) })
    const tool = def.tools.find((t) => t.name === 'check_settlement')
    if (!tool) throw new Error('check_settlement missing')
    return tool
  }

  it('refuses the FIRST empty draft with the vocabulary shape, passes the deliberate resubmit', async () => {
    const tool = checkTool(fragmented(FRAGMENTED_CONCERNS_MIN))
    const first = await tool.execute(EMPTY, {} as never)
    expect(first.isError).toBe(true)
    expect(first.content).toContain('under-merged')
    expect(first.content).toContain(`${FRAGMENTED_CONCERNS_MIN} concerns`)
    // Same empty draft again — a deliberate "nothing to merge" still finishes.
    const second = await tool.execute(EMPTY, {} as never)
    expect(second.isError).toBeUndefined()
    expect(second.content).toContain('Produce it as the outcome')
  })

  it('a draft that does real work is never pushed back', async () => {
    const vocab = fragmented(FRAGMENTED_CONCERNS_MIN)
    const tool = checkTool(vocab)
    const merged: AreaSettlement = { ...EMPTY, concernMerges: { 'topic-1': 'topic-0' } }
    const res = await tool.execute(merged, {} as never)
    expect(res.isError).toBeUndefined()
  })

  it('a small vocabulary passes an empty draft immediately', async () => {
    const tool = checkTool(fragmented(3))
    const res = await tool.execute(EMPTY, {} as never)
    expect(res.isError).toBeUndefined()
  })

  it('a collapse-to-core verdict counts as work, not a no-op', async () => {
    const rows: Record<string, [string, string][]> = {}
    for (let i = 0; i < FRAGMENTED_CONCERNS_MIN; i += 1) rows[`docs/d${i}.md`] = [['booking', `topic-${i}`]]
    const tool = checkTool(collectAreaVocab(tagMap(rows)))
    const collapsing: AreaSettlement = {
      ...EMPTY,
      productVerdicts: [{ product: 'booking', verdict: 'collapse-to-core' }],
    }
    const res = await tool.execute(collapsing, {} as never)
    expect(res.isError).toBeUndefined()
  })

  it('nearNameCandidates groups pure morphological variants and nothing else', () => {
    const vocab = collectAreaVocab(
      tagMap({
        'a.md': [['core', 'bookings-attendees']],
        'b.md': [['core', 'booking-attendees']],
        'c.md': [['core', 'attendees-booking']],
        'd.md': [['core', 'slots']],
        'e.md': [['core', 'recipients']],
      }),
    )
    expect(nearNameCandidates(vocab)).toEqual([
      ['attendees-booking', 'booking-attendees', 'bookings-attendees'],
    ])
  })

  it('the pushback names the morphological candidates', async () => {
    const rows: Record<string, [string, string][]> = {
      'x.md': [['core', 'bookings-attendees']],
      'y.md': [['core', 'booking-attendees']],
    }
    for (let i = 0; i < FRAGMENTED_CONCERNS_MIN; i += 1) rows[`docs/d${i}.md`] = [['core', `topic-${i}`]]
    const tool = checkTool(collectAreaVocab(tagMap(rows)))
    const res = await tool.execute(EMPTY, {} as never)
    expect(res.isError).toBe(true)
    expect(res.content).toContain('booking-attendees  ↔  bookings-attendees')
  })
})

// ---------------------------------------------------------------------------
// end to end through the scan run
// ---------------------------------------------------------------------------

let repo: string

beforeEach(() => {
  resetKvCacheStore()
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-settle-'))
})

afterEach(() => {
  resetKvCacheStore()
  fs.rmSync(repo, { recursive: true, force: true })
})

const IDENTITY: RepoIdentity = {
  name: 'Relkit',
  description: 'a release toolkit',
  aliases: ['Relkit', 'relkit'],
  sources: ['test'],
}

function writeDoc(rel: string, body: string): void {
  const abs = path.join(repo, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, body)
}

const COVERING: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  instructions: [],
  scopeVerdicts: ['.', 'docs'].map((p) => ({
    path: p,
    verdict: 'keep' as const,
    reason: 'covered by the test',
    decidedAt: '2026-01-01T00:00:00.000Z',
    resolvedBy: 'user' as const,
  })),
}

const keep = (product: string, concern: string): unknown => ({
  keep: true,
  reason: 'ok',
  subject: 'this-product',
  areas: [{ product, concern }],
  status: null,
})

function runScan(driver: () => Promise<import('../../packages/agent-loop/src/index').SessionDriver>) {
  return runSpecScanSessions({
    repoRoot: repo,
    driver,
    persistence: memoryPersistence().persistence,
    decisions: COVERING,
    repoIdentity: IDENTITY,
    skipGit: true,
    disableOverlapDetection: true,
    concurrency: 2,
  })
}

const settleCalls = (calls: readonly StubCall[]): StubCall[] =>
  calls.filter((c) => c.kind === SETTLE_AREAS_SESSION_KIND)

describe('spec-scan.settle-areas — through the run', () => {
  it('spends no session when the gate is closed', async () => {
    writeDoc('docs/users.md', '# Users\nThe user entity has an id.\n')
    writeDoc('docs/more-users.md', '# More users\nUsers may be deactivated by an admin.\n')
    const stub = stubDriver(() => outcome(keep('core', 'users')))
    const states: string[] = []

    const result = await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      decisions: COVERING,
      repoIdentity: IDENTITY,
      skipGit: true,
      disableOverlapDetection: true,
      onSettle: (state) => states.push(state),
    })

    expect(stub.calls.every((c) => c.kind === CURATE_DOC_SESSION_KIND)).toBe(true)
    expect(states).toEqual(['skipped'])
    expect(result.sessions.map((s) => s.kind)).not.toContain(SETTLE_AREAS_SESSION_KIND)
  })

  it('a collapse-to-core verdict reaches the grouper: the booking docs join core', async () => {
    writeDoc('docs/booking-auth.md', '# Booking auth\nA booking is authorized by its owner.\n')
    writeDoc('docs/core-auth.md', '# Auth\nSessions authenticate users with a bearer token.\n')
    const stub = stubDriver(async (call) => {
      if (call.kind === SETTLE_AREAS_SESSION_KIND) {
        await call.emit(toolResult('check_settlement', 'valid'))
        return outcome({
          concernMerges: {},
          productMerges: {},
          productVerdicts: [
            { product: 'booking', verdict: 'collapse-to-core', reason: 'a feature, not an app' },
          ],
          subdivisions: [],
        })
      }
      return outcome(
        docPathOf(call.briefing).includes('booking') ? keep('booking', 'auth') : keep('core', 'auth'),
      )
    })

    const result = await runScan(async () => stub.driver)

    expect(settleCalls(stub.calls)).toHaveLength(1)
    expect(result.corpus.areas.map((a) => a.id)).toEqual(['core/auth'])
    expect(result.corpus.docs.every((d) => d.areaTags.every((t) => t.startsWith('core/')))).toBe(true)
  })

  it('the shell refuses an outcome produced before `check_settlement` ran, once', async () => {
    writeDoc('docs/booking-auth.md', '# Booking auth\nA booking is authorized by its owner.\n')
    writeDoc('docs/core-auth.md', '# Auth\nSessions authenticate users with a bearer token.\n')
    const settlement = {
      concernMerges: {},
      productMerges: {},
      productVerdicts: [{ product: 'booking', verdict: 'justified', reason: 'a separate app' }],
      subdivisions: [],
    }
    const refusals: string[] = []
    let settleRuns = 0
    const stub = stubDriver((call) => {
      if (call.kind !== SETTLE_AREAS_SESSION_KIND) {
        return outcome(
          docPathOf(call.briefing).includes('booking') ? keep('booking', 'auth') : keep('core', 'auth'),
        )
      }
      // Never calls the validator — the first outcome must be handed back.
      settleRuns += 1
      if (settleRuns > 1) refusals.push(...call.input.initialMessages)
      return outcome(settlement)
    })

    const result = await runScan(async () => stub.driver)

    // Two DRIVER runs for one session: the refusal is a continuation, not a failure.
    expect(settleCalls(stub.calls)).toHaveLength(2)
    expect(refusals.join('\n')).toContain('you never ran `check_settlement`')
    expect(result.sessions.find((s) => s.kind === SETTLE_AREAS_SESSION_KIND)).toMatchObject({
      ran: 1,
      failed: 0,
    })
  })

  it('caches on the briefed vocabulary: a doc edit that moves no label is a settle hit', async () => {
    writeDoc('docs/booking-auth.md', '# Booking auth\nA booking is authorized by its owner.\n')
    writeDoc('docs/core-auth.md', '# Auth\nSessions authenticate users with a bearer token.\n')
    const script = (concernForCore: string) => async (call: StubCall) => {
      if (call.kind === SETTLE_AREAS_SESSION_KIND) {
        await call.emit(toolResult('check_settlement', 'valid'))
        return outcome({
          concernMerges: {},
          productMerges: {},
          productVerdicts: [{ product: 'booking', verdict: 'justified', reason: 'separate app' }],
          subdivisions: [],
        })
      }
      return outcome(
        docPathOf(call.briefing).includes('booking')
          ? keep('booking', 'auth')
          : keep('core', concernForCore),
      )
    }

    const cold = stubDriver(script('auth'))
    const first = await runScan(async () => cold.driver)
    expect(first.sessions.find((s) => s.kind === SETTLE_AREAS_SESSION_KIND)).toMatchObject({
      ran: 1,
      fromCache: 0,
    })

    // Edit the doc's CONTENT — its curate cache entry misses and re-sessions,
    // but the labels it reports are unchanged, so the settlement is a hit.
    writeDoc('docs/core-auth.md', '# Auth\nSessions authenticate users with a signed bearer token.\n')
    const warm = stubDriver(script('auth'))
    const second = await runScan(async () => warm.driver)
    expect(warm.calls.filter((c) => c.kind === CURATE_DOC_SESSION_KIND)).toHaveLength(1)
    expect(second.sessions.find((s) => s.kind === SETTLE_AREAS_SESSION_KIND)).toMatchObject({
      ran: 0,
      fromCache: 1,
    })

    // Move a LABEL and the key moves with it.
    writeDoc('docs/core-auth.md', '# Auth\nSessions authenticate users with a bearer token now.\n')
    const moved = stubDriver(script('sessions'))
    const third = await runScan(async () => moved.driver)
    expect(third.sessions.find((s) => s.kind === SETTLE_AREAS_SESSION_KIND)).toMatchObject({
      ran: 1,
      fromCache: 0,
    })
  })
})
