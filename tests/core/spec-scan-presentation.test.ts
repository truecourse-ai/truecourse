/**
 * HOW THE SCAN SESSIONS PRESENT THEMSELVES — the `display` copy each def
 * declares and the `presentOutcome` digests that turn a validated outcome into
 * render blocks. Every fixture goes through the def's OWN `outcomeSchema`, so a
 * presenter reading a field the schema does not write cannot pass (the bug this
 * layer replaces: a digest keyed on `verdicts` while the schema writes
 * `scopeVerdicts`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache'
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs'
import { KnownDisplayBlockSchema, RunRecordSchema } from '../../packages/agent-loop/src/index'
import { CURATE_STEPS, curateInProcess } from '../../packages/core/src/commands/spec-in-process'
import { listStoredSessionRuns } from '../../packages/core/src/lib/sessions-store'
import { StepTracker } from '../../packages/core/src/progress'
import {
  ScanScopeOutcomeSchema,
  buildScanScopeUniverse,
  orchestrateSessionDef,
} from '../../packages/core/src/services/spec-scan/orchestrate'
import {
  DocVerdictSchema,
  curateDocSessionDef,
} from '../../packages/core/src/services/spec-scan/curate-doc'
import { EXTRACT_CLAIMS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/extract-claims'
import { SETTLE_SUBJECTS_SESSION_KIND } from '../../packages/core/src/services/spec-scan/settle-subjects'
import { COMPARE_CLAIMS_SESSION_KIND, presentConflict, type ReportedConflict } from '../../packages/core/src/services/spec-scan/compare-claims'
import { compare, record as extractClaims, settle } from './spec-scan-claims-stub'
import {
  AreaSettlementSchema,
  settleAreasSessionDef,
} from '../../packages/core/src/services/spec-scan/settle-areas'
import { buildScanUniverse } from '../../packages/core/src/services/spec-scan/tools'
import type { DocCandidate } from '../../packages/spec-consolidator/src/index.js'
import { outcome, stubDriver, toolResult } from './spec-scan-session-stub'

const emptyScope = () => buildScanScopeUniverse(buildScanUniverse([]))

const doc = (path: string): DocCandidate => ({
  path,
  absPath: '',
  content: `# ${path}\n`,
  kind: 'spec',
  preview: `# ${path}`,
  lastTouched: '2026-01-01T00:00:00.000Z',
  contentHash: 'hash',
  size: 32,
})

/** Every presenter's output must be a WELL-FORMED block of the shared
 *  vocabulary — readers are tolerant, writers are not. */
function assertBlocks(blocks: unknown): void {
  for (const block of blocks as unknown[]) expect(() => KnownDisplayBlockSchema.parse(block)).not.toThrow()
}

describe('spec-scan.orchestrate — presentOutcome', () => {
  const present = () => {
    const def = orchestrateSessionDef(emptyScope())
    if (!def.presentOutcome) throw new Error('orchestrate declares no presentOutcome')
    return def.presentOutcome
  }

  it('digests the scope verdicts, naming what was left out and why', () => {
    const outcome = ScanScopeOutcomeSchema.parse({
      scopeVerdicts: [
        { path: 'docs', verdict: 'keep', reason: 'the product docs' },
        { path: 'docs/archive', verdict: 'exclude', reason: 'superseded material' },
        { path: 'i18n', verdict: 'exclude', reason: 'machine-translated copies' },
      ],
      instructions: [],
    })
    const blocks = present()(outcome)
    assertBlocks(blocks)
    expect(blocks).toEqual([
      {
        kind: 'facts',
        lines: [
          "I set the scan's scope: 1 of 3 doc subtrees kept",
          'left out docs/archive: superseded material',
          'left out i18n: machine-translated copies',
          'no extra instructions for the scan sessions',
        ],
      },
    ])
  })

  it('says so when nothing was left out and instructions were written', () => {
    const outcome = ScanScopeOutcomeSchema.parse({
      scopeVerdicts: [{ path: '.', verdict: 'keep', reason: 'the root readme specs the API' }],
      instructions: ['docs under handbook/ describe company process, not product behavior'],
    })
    expect(present()(outcome)).toEqual([
      {
        kind: 'facts',
        lines: [
          "I set the scan's scope: 1 of 1 doc subtrees kept, nothing left out",
          'instruction for the scan: docs under handbook/ describe company process, not product behavior',
        ],
      },
    ])
  })

  it('renders the observations the outcome carries', () => {
    const outcome = ScanScopeOutcomeSchema.parse({
      scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'the product docs' }],
      instructions: [],
      findings: ['docs/legacy looks abandoned — nothing touched since 2019'],
    })
    const blocks = present()(outcome)
    assertBlocks(blocks)
    expect(blocks[1]).toEqual({
      kind: 'facts',
      lines: ['worth a look: docs/legacy looks abandoned — nothing touched since 2019'],
    })
  })

  it('digests a long exclusion list instead of rendering every subtree', () => {
    const outcome = ScanScopeOutcomeSchema.parse({
      scopeVerdicts: [
        { path: 'docs', verdict: 'keep', reason: 'the product docs' },
        ...Array.from({ length: 9 }, (_, i) => ({
          path: `vendored/dep-${i}`,
          verdict: 'exclude' as const,
          reason: 'third-party',
        })),
      ],
      instructions: [],
    })
    const blocks = present()(outcome)
    assertBlocks(blocks)
    const lines = (blocks[0] as { lines: string[] }).lines
    expect(lines[0]).toBe("I set the scan's scope: 1 of 10 doc subtrees kept")
    expect(lines).toHaveLength(1 + 6 + 1 + 1) // summary + capped exclusions + rest count + instructions line
    expect(lines[7]).toBe('…and 3 more subtrees left out')
  })
})

describe('a conflict card', () => {
  it('carries the note, the quotes, the recommendation and the conflict identity', () => {
    const conflict: ReportedConflict = {
          docs: ['docs/api/users.md', 'docs/api/identity.md'],
          note: 'users.md uses auth0_id; identity.md uses auth0_sub',
          sections: [
            { doc: 'docs/api/users.md', quote: 'the `auth0_id` field holds the subject', sentence: 's-users' },
            { doc: 'docs/api/identity.md', quote: 'we store `auth0_sub` on every account', sentence: 's-identity' },
          ],
          review: {
            explanation: 'users.md says auth0_id, identity.md says auth0_sub — one field, two names.',
            recommendation: {
              action: 'pick-b',
              rationale: 'identity.md is the owner of the account schema',
              confidence: 'high',
            },
          },
        }
    const blocks = [presentConflict(conflict)]
    assertBlocks(blocks)
    expect(blocks[0]).toEqual({
      kind: 'conflict',
      claim: 'users.md uses auth0_id; identity.md uses auth0_sub',
      quotes: [
        { doc: 'docs/api/users.md', quote: 'the `auth0_id` field holds the subject' },
        { doc: 'docs/api/identity.md', quote: 'we store `auth0_sub` on every account' },
      ],
      recommendation: {
        doc: 'docs/api/identity.md',
        side: 'b',
        rationale: 'identity.md is the owner of the account schema',
        confidence: 'high',
      },
      conflict: {
        docA: 'docs/api/users.md',
        quoteA: 'the `auth0_id` field holds the subject',
        sentenceA: 's-users',
        docB: 'docs/api/identity.md',
        quoteB: 'we store `auth0_sub` on every account',
        sentenceB: 's-identity',
      },
    })
  })

})

describe('spec-scan.curate-doc — presentOutcome', () => {
  const present = () => {
    const def = curateDocSessionDef({
      doc: doc('docs/orders.md'),
      universe: buildScanUniverse([]),
      liveVocab: () => ({ products: [], concerns: [] }),
    })
    if (!def.presentOutcome) throw new Error('curate-doc declares no presentOutcome')
    return def.presentOutcome
  }

  it('says it kept the doc and which areas it covers', () => {
    const outcome = DocVerdictSchema.parse({
      keep: true,
      reason: 'states the cancellation rules',
      subject: 'this-product',
      areas: [
        { product: 'core', concern: 'orders' },
        { product: 'core', concern: 'billing' },
      ],
      status: 'shipped',
    })
    const blocks = present()(outcome)
    assertBlocks(blocks)
    expect(blocks).toEqual([
      {
        kind: 'facts',
        lines: [
          "I'm keeping this doc: states the cancellation rules",
          'Areas it covers: core / orders, core / billing',
          'The doc states its status: shipped',
        ],
      },
    ])
  })

  it('names the skip category when it leaves a doc out', () => {
    const outcome = DocVerdictSchema.parse({
      keep: false,
      reason: 'describes a different product (ServiceTitan)',
      subject: 'different-product',
      category: 'third-party',
      areas: [],
      status: null,
    })
    const blocks = present()(outcome)
    assertBlocks(blocks)
    expect(blocks).toEqual([
      {
        kind: 'facts',
        lines: [
          "I'm leaving this doc out (third-party): describes a different product (ServiceTitan)",
          'It covers no area I could name',
        ],
      },
    ])
  })
})

describe('spec-scan.settle-areas — presentOutcome', () => {
  const present = () => {
    const def = settleAreasSessionDef({
      vocab: { products: new Map(), concerns: new Map(), overThreshold: [] },
      universe: buildScanUniverse([]),
    })
    if (!def.presentOutcome) throw new Error('settle-areas declares no presentOutcome')
    return def.presentOutcome
  }

  it('reports the merges, the product verdicts and the subdivisions', () => {
    const outcome = AreaSettlementSchema.parse({
      concernMerges: { authentication: 'auth', appointment: 'appointments' },
      productMerges: { 'booking-app': 'booking' },
      productVerdicts: [
        { product: 'booking', verdict: 'justified', reason: 'a separately deployed app' },
        { product: 'orders', verdict: 'collapse-to-core', reason: 'a feature wearing a product name' },
      ],
      subdivisions: [{ label: 'api', into: ['auth', 'webhooks'], assignments: { 'docs/api.md': 'auth' } }],
    })
    const blocks = present()(outcome)
    assertBlocks(blocks)
    expect(blocks).toEqual([
      {
        kind: 'facts',
        lines: [
          'I merged 2 concern labels into ones already in use',
          'I merged 1 product label',
          'I judged 2 non-core products: 1 kept apart, 1 folded into core',
          'I split api into auth, webhooks',
        ],
      },
    ])
  })

  it('says plainly when there was nothing to settle', () => {
    const outcome = AreaSettlementSchema.parse({
      concernMerges: {},
      productMerges: {},
      productVerdicts: [],
      subdivisions: [],
    })
    expect(present()(outcome)).toEqual([
      { kind: 'facts', lines: ['I merged nothing — the labels already name distinct things'] },
    ])
  })
})

/**
 * The run-level half of the same contract: the run stamps its phase checklist
 * as a display block in the very vocabulary its sessions use, and each item
 * names the session kinds that do its work, so a reader places sessions under
 * phases without a table of its own.
 */
describe('spec scan run record — the checklist block', () => {
  let repo: string
  beforeEach(() => {
    installMemoryKvCache()
    installMemorySessionRuns()
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-kinds-'))
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'docs', 'alpha.md'), '# Orders alpha\nCancel up to 24h before.')
  })
  afterEach(() => {
    resetKvCacheStore()
    resetSessionRuns()
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it('stamps each checklist item with the kinds that do its work', async () => {
    const driver = stubDriver(async (call) => {
      if (call.kind === 'spec-scan.settle-areas') {
        await call.emit(toolResult('check_settlement', 'valid'))
        return outcome({ concernMerges: [], productMerges: [], productVerdicts: [], subdivisions: [] })
      }
      if (call.kind === EXTRACT_CLAIMS_SESSION_KIND) return extractClaims(call, () => null)
      if (call.kind === SETTLE_SUBJECTS_SESSION_KIND) return settle(call)
      if (call.kind === COMPARE_CLAIMS_SESSION_KIND) return compare(call)
      return outcome({
        keep: true,
        reason: 'spec',
        subject: 'this-product',
        areas: [{ product: 'core', concern: 'orders' }],
        status: 'shipped',
      })
    }).driver

    const tracker = new StepTracker(() => {}, [...CURATE_STEPS])
    await curateInProcess(repo, {
      skipGit: true,
      skipCorpusWrite: true,
      tracker,
      driver,
      transportMode: 'api',
      decisions: {
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
      },
    })

    const [stored] = await listStoredSessionRuns(repo, 'spec-scan')
    const record = RunRecordSchema.parse(stored)
    // No bespoke run-level field: the checklist is one block among whatever
    // else the run chooses to say.
    // An injected driver states what it ran on too: a hosted run whose record
    // named no provider at all was the record lying about a real one.
    expect(record.llm).toEqual({ mode: 'api', provider: 'test', model: 'scripted' })
    const block = KnownDisplayBlockSchema.parse(record.display?.blocks[0])
    if (block.kind !== 'checklist') throw new Error('the run stamped no checklist block')
    expect(block.items.map((item) => [item.key, item.sessionKinds])).toEqual([
      ['discover', ['spec-scan.orchestrate']],
      ['tag', ['spec-scan.curate-doc', 'spec-scan.settle-areas']],
      ['record', ['spec-scan.extract-claims']],
      ['subjects', ['spec-scan.settle-subjects']],
      ['compare', ['spec-scan.compare-claims']],
      ['conflicts', []],
      ['verify', []],
    ])
  })
})


describe('spec-scan defs — declared display', () => {
  const defs = () => [
    orchestrateSessionDef(emptyScope()),
    curateDocSessionDef({
      doc: doc('docs/orders.md'),
      universe: buildScanUniverse([]),
      liveVocab: () => ({ products: [], concerns: [] }),
    }),
    settleAreasSessionDef({
      vocab: { products: new Map(), concerns: new Map(), overThreshold: [] },
      universe: buildScanUniverse([]),
    }),
  ]

  it('names the kind of work it is, so a run can label the session', () => {
    expect(defs().map((def) => def.display?.title)).toEqual([
      'Scan scope',
      'Document curation',
      'Area settling',
    ])
  })

  it('opens every session with a line of its own, naming its work item', () => {
    for (const def of defs()) expect(def.display?.intro, def.kind).toBeTruthy()
    const [, curate] = defs()
    expect(curate.display?.intro).toBe(
      "I'm reading doc:docs/orders.md to decide whether it belongs in the corpus and which areas it covers.",
    )
  })

  it('gives every tool a phrase whose plural keeps the call count', () => {
    for (const def of defs()) {
      for (const tool of def.tools) {
        expect(tool.display, `${def.kind} · ${tool.name}`).toBeDefined()
        expect(tool.display?.many, `${def.kind} · ${tool.name}`).toContain('{n}')
        expect(tool.display?.one, `${def.kind} · ${tool.name}`).toBeTruthy()
      }
    }
  })

  it('phrases read_doc for the session that opens it', () => {
    const [, curate, settle] = defs()
    expect(curate.tools.find((t) => t.name === 'read_doc')?.display).toEqual({
      one: 'I read the doc in full',
      many: 'I read the doc in full, {n} passes',
    })
    expect(settle.tools.find((t) => t.name === 'read_doc')?.display).toEqual({
      one: "I opened one of a label's docs to judge it by more than its title",
      many: 'I opened {n} docs to judge the labels by more than their titles',
    })
  })
})
