import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Adr, AdrDraft, TopicSignature } from '../../packages/shared/src/types/adr'
import {
  appendRejectedSignature,
  clearAdrCorpusCache,
  deleteAdrCorpus,
  deleteAdrDraft,
  ensureAdrDraftsDir,
  findAdrById,
  findAdrsLinkedToNode,
  listAdrDrafts,
  readAdrCorpus,
  readAdrDraft,
  readRejectedSignatures,
  writeAdrCorpus,
  writeAdrDraft,
  writeRejectedSignatures,
} from '../../apps/server/src/lib/adr-store'
import {
  getAdrCorpusPath,
  getAdrDraftPath,
  getAdrDraftsDir,
  getAdrRejectedPath,
} from '../../apps/server/src/config/paths'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-adr-store-'))
  clearAdrCorpusCache()
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAdr(overrides: Partial<Adr> = {}): Adr {
  return {
    id: 'ADR-0001',
    number: 1,
    title: 'Use event bus',
    status: 'accepted',
    date: '2026-04-21',
    path: 'docs/adr/ADR-0001-event-bus.md',
    sections: { context: 'c', decision: 'd', consequences: 'q' },
    linkedNodeIds: ['svc-a', 'svc-b'],
    requiredEntities: ['svc-a', 'svc-b'],
    ...overrides,
  }
}

function makeDraft(overrides: Partial<AdrDraft> = {}): AdrDraft {
  return {
    id: 'draft-abc',
    createdAt: '2026-04-21T10:00:00.000Z',
    title: 'Circular dependency',
    topic: 'circular-dependency',
    entities: ['auth-service', 'billing-service'],
    madrBody:
      '# Circular dependency\n\n' +
      '## Context\nSome context.\n\n' +
      '## Decision\nAccept it.\n\n' +
      '## Consequences\nLooser coupling.\n',
    confidence: 0.7,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Corpus round-trip
// ---------------------------------------------------------------------------

describe('adr corpus', () => {
  it('returns null before any write', () => {
    expect(readAdrCorpus(repoPath)).toBeNull()
  })

  it('round-trips a corpus', () => {
    const corpus = { generatedAt: '2026-04-21T10:00:00.000Z', adrs: [makeAdr()] }
    writeAdrCorpus(repoPath, corpus)
    expect(readAdrCorpus(repoPath)).toEqual(corpus)
    expect(fs.existsSync(getAdrCorpusPath(repoPath))).toBe(true)
  })

  it('deleteAdrCorpus clears both file and cache', () => {
    writeAdrCorpus(repoPath, { generatedAt: 'x', adrs: [] })
    readAdrCorpus(repoPath)                     // populate cache
    deleteAdrCorpus(repoPath)
    expect(readAdrCorpus(repoPath)).toBeNull()
    expect(fs.existsSync(getAdrCorpusPath(repoPath))).toBe(false)
  })

  it('invalidates the in-memory cache when the file changes on disk', () => {
    writeAdrCorpus(repoPath, { generatedAt: 't1', adrs: [] })
    expect(readAdrCorpus(repoPath)?.generatedAt).toBe('t1')

    writeAdrCorpus(repoPath, { generatedAt: 't2', adrs: [makeAdr()] })
    // Bump mtime forward so cache invalidation triggers even on same-ms writes.
    const future = new Date(Date.now() + 1000)
    fs.utimesSync(getAdrCorpusPath(repoPath), future, future)

    const second = readAdrCorpus(repoPath)
    expect(second?.generatedAt).toBe('t2')
    expect(second?.adrs).toHaveLength(1)
  })

  it('recovers from a deleted file on next read', () => {
    writeAdrCorpus(repoPath, { generatedAt: 'x', adrs: [] })
    readAdrCorpus(repoPath)
    fs.unlinkSync(getAdrCorpusPath(repoPath))
    expect(readAdrCorpus(repoPath)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

describe('adr drafts', () => {
  it('returns [] when the drafts dir is absent', () => {
    expect(listAdrDrafts(repoPath)).toEqual([])
  })

  it('round-trips a single draft', () => {
    const d = makeDraft()
    writeAdrDraft(repoPath, d)
    expect(readAdrDraft(repoPath, d.id)).toEqual(d)
    expect(fs.existsSync(getAdrDraftPath(repoPath, d.id))).toBe(true)
  })

  it('lists drafts in chronological order (oldest first)', () => {
    const a = makeDraft({ id: 'd-a', createdAt: '2026-04-21T10:00:00.000Z' })
    const b = makeDraft({ id: 'd-b', createdAt: '2026-04-21T11:00:00.000Z' })
    const c = makeDraft({ id: 'd-c', createdAt: '2026-04-21T09:00:00.000Z' })
    writeAdrDraft(repoPath, a)
    writeAdrDraft(repoPath, b)
    writeAdrDraft(repoPath, c)
    expect(listAdrDrafts(repoPath).map((d) => d.id)).toEqual(['d-c', 'd-a', 'd-b'])
  })

  it('deleteAdrDraft removes the file; double-delete is safe', () => {
    const d = makeDraft()
    writeAdrDraft(repoPath, d)
    deleteAdrDraft(repoPath, d.id)
    expect(readAdrDraft(repoPath, d.id)).toBeNull()
    expect(() => deleteAdrDraft(repoPath, d.id)).not.toThrow()
  })

  it('ensureAdrDraftsDir creates the directory', () => {
    const dir = ensureAdrDraftsDir(repoPath)
    expect(fs.existsSync(dir)).toBe(true)
    expect(dir).toBe(getAdrDraftsDir(repoPath))
  })

  it('readAdrDraft returns null for unknown ids', () => {
    expect(readAdrDraft(repoPath, 'does-not-exist')).toBeNull()
  })

  it('ignores non-md files in the drafts directory', () => {
    writeAdrDraft(repoPath, makeDraft())
    fs.writeFileSync(path.join(getAdrDraftsDir(repoPath), 'README.txt'), 'hello')
    fs.writeFileSync(path.join(getAdrDraftsDir(repoPath), 'stale.json'), '{}')
    expect(listAdrDrafts(repoPath)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Rejected signatures
// ---------------------------------------------------------------------------

describe('adr rejected signatures', () => {
  it('starts empty', () => {
    expect(readRejectedSignatures(repoPath)).toEqual([])
  })

  it('append adds entries in order', () => {
    const s1: TopicSignature = { topic: 'circular-dependency', entities: ['a', 'b'] }
    const s2: TopicSignature = { topic: 'shared-database', entities: ['c'] }
    appendRejectedSignature(repoPath, s1)
    appendRejectedSignature(repoPath, s2)
    expect(readRejectedSignatures(repoPath)).toEqual([s1, s2])
    expect(fs.existsSync(getAdrRejectedPath(repoPath))).toBe(true)
  })

  it('writeRejectedSignatures replaces the full list', () => {
    appendRejectedSignature(repoPath, { topic: 'x', entities: [] })
    writeRejectedSignatures(repoPath, [{ topic: 'y', entities: ['z'] }])
    expect(readRejectedSignatures(repoPath)).toEqual([{ topic: 'y', entities: ['z'] }])
  })
})

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

describe('adr lookups', () => {
  it('findAdrById returns the matching ADR', () => {
    writeAdrCorpus(repoPath, {
      generatedAt: 't',
      adrs: [makeAdr({ id: 'ADR-0001' }), makeAdr({ id: 'ADR-0002', number: 2 })],
    })
    expect(findAdrById(repoPath, 'ADR-0002')?.id).toBe('ADR-0002')
    expect(findAdrById(repoPath, 'ADR-9999')).toBeNull()
  })

  it('findAdrById returns null when the corpus is missing', () => {
    expect(findAdrById(repoPath, 'ADR-0001')).toBeNull()
  })

  it('findAdrsLinkedToNode returns all matching ADRs', () => {
    const a = makeAdr({ id: 'ADR-0001', linkedNodeIds: ['svc-a'] })
    const b = makeAdr({ id: 'ADR-0002', number: 2, linkedNodeIds: ['svc-a', 'svc-b'] })
    const c = makeAdr({ id: 'ADR-0003', number: 3, linkedNodeIds: ['svc-c'] })
    writeAdrCorpus(repoPath, { generatedAt: 't', adrs: [a, b, c] })
    const linked = findAdrsLinkedToNode(repoPath, 'svc-a').map((adr) => adr.id)
    expect(linked.sort()).toEqual(['ADR-0001', 'ADR-0002'])
  })
})

// ===========================================================================
// Additional imports for parser, signatures, and staleness tests (folded from
// adr-parser.test.ts, adr-signatures.test.ts, adr-staleness.test.ts)
// ===========================================================================

import {
  AdrParseError,
  parseAdr,
  serializeAdr,
  computeSignature,
  filterRejected,
  isDraftRejected,
  isRejected,
  refreshAdrStaleness,
} from '../../apps/server/src/lib/adr-store'
import type { Graph } from '../../apps/server/src/types/snapshot'

// ===========================================================================
// MADR parser / serializer
// ===========================================================================

const MINIMAL_MADR = `---
status: accepted
date: 2026-04-21
---

# ADR-0005: Use an event bus for cross-service communication

## Context

Services are growing; direct HTTP is becoming tangled.

## Decision

Introduce an event bus.

## Consequences

New ops burden; looser coupling.
`

const RICH_MADR = `---
status: superseded
date: 2026-03-15
deciders: [alice, bob]
supersedes: [ADR-0002, ADR-0003]
superseded-by: ADR-0008
linked-node-ids: [auth-service, billing-service]
required-entities: [auth-service]
source-draft-id: draft-abc123
---

# ADR-0005: Split the auth service

## Context

The service has grown too large.

## Decision

Split it.

## Consequences

Operational complexity increases.
`

describe('parseAdr — minimal', () => {
  it('parses a minimal MADR file', () => {
    const adr = parseAdr({ filePath: 'docs/adr/ADR-0005-event-bus.md', source: MINIMAL_MADR })
    expect(adr.id).toBe('ADR-0005')
    expect(adr.number).toBe(5)
    expect(adr.title).toBe('Use an event bus for cross-service communication')
    expect(adr.status).toBe('accepted')
    expect(adr.date).toBe('2026-04-21')
    expect(adr.sections.context).toContain('Services are growing')
    expect(adr.sections.decision).toBe('Introduce an event bus.')
    expect(adr.sections.consequences).toContain('New ops burden')
    expect(adr.linkedNodeIds).toEqual([])
    expect(adr.requiredEntities).toEqual([])
    expect(adr.path).toBe('docs/adr/ADR-0005-event-bus.md')
  })

  it('omits optional fields when absent', () => {
    const adr = parseAdr({ filePath: 'x.md', source: MINIMAL_MADR })
    expect(adr.deciders).toBeUndefined()
    expect(adr.supersedes).toBeUndefined()
    expect(adr.supersededBy).toBeUndefined()
    expect(adr.sourceDraftId).toBeUndefined()
  })
})

describe('parseAdr — rich', () => {
  it('parses deciders, supersedes, superseded-by, linked-node-ids, required-entities, source-draft-id', () => {
    const adr = parseAdr({ filePath: 'x.md', source: RICH_MADR })
    expect(adr.status).toBe('superseded')
    expect(adr.deciders).toEqual(['alice', 'bob'])
    expect(adr.supersedes).toEqual(['ADR-0002', 'ADR-0003'])
    expect(adr.supersededBy).toBe('ADR-0008')
    expect(adr.linkedNodeIds).toEqual(['auth-service', 'billing-service'])
    expect(adr.requiredEntities).toEqual(['auth-service'])
    expect(adr.sourceDraftId).toBe('draft-abc123')
  })

  it('falls back requiredEntities to linkedNodeIds when required-entities is absent', () => {
    const withoutRequired = RICH_MADR.replace('required-entities: [auth-service]\n', '')
    const adr = parseAdr({ filePath: 'x.md', source: withoutRequired })
    expect(adr.requiredEntities).toEqual(['auth-service', 'billing-service'])
  })
})

describe('parseAdr — errors', () => {
  it('throws when frontmatter block is missing', () => {
    const body = '# ADR-0001: Foo\n\n## Context\nc\n## Decision\nd\n## Consequences\nq\n'
    expect(() => parseAdr({ filePath: 'x.md', source: body })).toThrow(AdrParseError)
  })

  it('throws when status is missing', () => {
    const src = `---
date: 2026-04-21
---

# ADR-0001: Foo

## Context
c

## Decision
d

## Consequences
q
`
    expect(() => parseAdr({ filePath: 'x.md', source: src })).toThrowError(/status/)
  })

  it('throws when status is unknown', () => {
    const src = MINIMAL_MADR.replace('status: accepted', 'status: bogus')
    expect(() => parseAdr({ filePath: 'x.md', source: src })).toThrowError(/invalid status/)
  })

  it('rejects `status: stale` in a file (computed-only)', () => {
    const src = MINIMAL_MADR.replace('status: accepted', 'status: stale')
    expect(() => parseAdr({ filePath: 'x.md', source: src })).toThrowError(/computed status/)
  })

  it('throws when title is missing or malformed', () => {
    const src = MINIMAL_MADR.replace('# ADR-0005: Use an event bus for cross-service communication', '# No ADR here')
    expect(() => parseAdr({ filePath: 'x.md', source: src })).toThrowError(/missing or malformed title/)
  })

  it('throws when a required section is missing', () => {
    const src = MINIMAL_MADR.replace(/## Consequences[\s\S]*/, '')
    expect(() => parseAdr({ filePath: 'x.md', source: src })).toThrowError(/Consequences/)
  })

  it('throws on malformed frontmatter line', () => {
    const src = `---
status: accepted
date 2026-04-21
---

# ADR-0001: Foo

## Context
c

## Decision
d

## Consequences
q
`
    expect(() => parseAdr({ filePath: 'x.md', source: src })).toThrowError(/malformed frontmatter/)
  })
})

describe('serializeAdr ↔ parseAdr round-trip', () => {
  function roundTrip(adr: Adr): Adr {
    const source = serializeAdr(adr)
    return parseAdr({ filePath: adr.path, source })
  }

  it('round-trips a minimal accepted ADR', () => {
    const original: Adr = {
      id: 'ADR-0001',
      number: 1,
      title: 'Do a thing',
      status: 'accepted',
      date: '2026-04-21',
      path: 'docs/adr/ADR-0001-thing.md',
      sections: { context: 'ctx', decision: 'dec', consequences: 'con' },
      linkedNodeIds: [],
      requiredEntities: [],
    }
    expect(roundTrip(original)).toEqual(original)
  })

  it('round-trips a rich ADR with all optional fields', () => {
    const original: Adr = {
      id: 'ADR-0042',
      number: 42,
      title: 'Migrate to PostgreSQL',
      status: 'superseded',
      date: '2026-03-15',
      path: 'docs/adr/ADR-0042-postgres.md',
      sections: {
        context: 'Context prose across\nmultiple lines.',
        decision: 'Decision.',
        consequences: 'Consequences.',
      },
      deciders: ['alice', 'bob'],
      linkedNodeIds: ['svc-a', 'svc-b'],
      supersedes: ['ADR-0003'],
      supersededBy: 'ADR-0099',
      requiredEntities: ['svc-a'],
      sourceDraftId: 'draft-xyz',
    }
    expect(roundTrip(original)).toEqual(original)
  })
})

// ===========================================================================
// Signature helpers (computeSignature / isRejected / isDraftRejected / filterRejected)
// ===========================================================================

describe('signatures', () => {
  function sigDraft(overrides: Partial<AdrDraft> = {}): AdrDraft {
    return {
      id: 'draft-1',
      createdAt: '2026-04-21T10:00:00.000Z',
      title: 'Circular dep between auth and billing',
      topic: 'circular-dependency',
      entities: ['auth-service', 'billing-service'],
      madrBody: '# body',
      confidence: 0.8,
      ...overrides,
    }
  }

  describe('computeSignature', () => {
    it('returns the draft topic and its entities sorted', () => {
      const sig = computeSignature(sigDraft({ entities: ['billing-service', 'auth-service'] }))
      expect(sig).toEqual({
        topic: 'circular-dependency',
        entities: ['auth-service', 'billing-service'],
      })
    })

    it('dedupes duplicate entities', () => {
      const sig = computeSignature(sigDraft({ entities: ['svc-a', 'svc-a', 'svc-b'] }))
      expect(sig.entities).toEqual(['svc-a', 'svc-b'])
    })

    it('produces the same signature regardless of entity order', () => {
      const a = computeSignature(sigDraft({ entities: ['a', 'b', 'c'] }))
      const b = computeSignature(sigDraft({ entities: ['c', 'a', 'b'] }))
      expect(a).toEqual(b)
    })

    it('produces different signatures when entity sets differ', () => {
      const a = computeSignature(sigDraft({ entities: ['a', 'b'] }))
      const b = computeSignature(sigDraft({ entities: ['a', 'c'] }))
      expect(a).not.toEqual(b)
    })

    it('produces different signatures for different topics on the same entities', () => {
      const a = computeSignature(sigDraft({ topic: 'circular-dependency' }))
      const b = computeSignature(sigDraft({ topic: 'shared-database' }))
      expect(a.topic).not.toEqual(b.topic)
    })
  })

  describe('isRejected', () => {
    const rejected: TopicSignature[] = [
      { topic: 'circular-dependency', entities: ['auth-service', 'billing-service'] },
      { topic: 'shared-database', entities: ['orders-service', 'users-service'] },
    ]

    it('returns true for a matching signature', () => {
      const sig = computeSignature(sigDraft({ entities: ['billing-service', 'auth-service'] }))
      expect(isRejected(sig, rejected)).toBe(true)
    })

    it('returns false for a non-matching topic', () => {
      const sig = computeSignature(sigDraft({ topic: 'facade-module' }))
      expect(isRejected(sig, rejected)).toBe(false)
    })

    it('returns false when entity sets differ', () => {
      const sig = computeSignature(sigDraft({ entities: ['auth-service', 'orders-service'] }))
      expect(isRejected(sig, rejected)).toBe(false)
    })

    it('survives an unsorted rejected signature constructed by hand', () => {
      const sig = computeSignature(sigDraft())
      const unsorted: TopicSignature[] = [
        { topic: 'circular-dependency', entities: ['billing-service', 'auth-service'] },
      ]
      expect(isRejected(sig, unsorted)).toBe(true)
    })
  })

  describe('isDraftRejected', () => {
    it('computes the draft signature and checks it', () => {
      const rejected: TopicSignature[] = [
        { topic: 'circular-dependency', entities: ['auth-service', 'billing-service'] },
      ]
      expect(isDraftRejected(sigDraft(), rejected)).toBe(true)
      expect(isDraftRejected(sigDraft({ topic: 'service-boundary' }), rejected)).toBe(false)
    })
  })

  describe('filterRejected', () => {
    it('drops drafts whose signatures are in the rejected list', () => {
      const rejected: TopicSignature[] = [
        { topic: 'circular-dependency', entities: ['auth-service', 'billing-service'] },
      ]
      const drafts = [
        sigDraft({ id: 'd1' }),
        sigDraft({ id: 'd2', topic: 'shared-database' }),
        sigDraft({ id: 'd3', entities: ['orders-service'] }),
      ]
      expect(filterRejected(drafts, rejected).map((d) => d.id)).toEqual(['d2', 'd3'])
    })

    it('returns all drafts when the rejected list is empty', () => {
      const drafts = [sigDraft()]
      expect(filterRejected(drafts, [])).toEqual(drafts)
    })
  })
})

// ===========================================================================
// Structural staleness (refreshAdrStaleness)
// ===========================================================================

describe('refreshAdrStaleness', () => {
  function emptyGraph(): Graph {
    return {
      services: [], serviceDependencies: [], layers: [], modules: [],
      methods: [], moduleDeps: [], methodDeps: [], databases: [],
      databaseConnections: [], flows: [],
    }
  }

  function graphWithServices(names: string[]): Graph {
    const g = emptyGraph()
    g.services = names.map((n) => ({
      id: `svc-${n}`, name: n, rootPath: `/${n}`, type: 'api-server',
      framework: null, fileCount: 1, description: null, layerSummary: null,
    }))
    return g
  }

  function stalenessAdr(overrides: Partial<Adr> = {}): Adr {
    return {
      id: 'ADR-0001',
      number: 1,
      title: 'Use event bus',
      status: 'accepted',
      date: '2026-04-21',
      path: 'docs/adr/ADR-0001-use-event-bus.md',
      sections: { context: 'c', decision: 'd', consequences: 'q' },
      linkedNodeIds: ['auth-service'],
      requiredEntities: ['auth-service'],
      ...overrides,
    }
  }

  describe('no-op paths', () => {
    it('returns zero-inspected when no corpus exists', () => {
      const result = refreshAdrStaleness(repoPath, emptyGraph())
      expect(result.inspected).toBe(0)
      expect(result.newlyStale).toEqual([])
    })
  })

  describe('flagging', () => {
    it('flags an ADR stale when a required entity is gone', () => {
      writeAdrCorpus(repoPath, { generatedAt: 't', adrs: [stalenessAdr()] })
      const result = refreshAdrStaleness(repoPath, emptyGraph())
      expect(result.inspected).toBe(1)
      expect(result.newlyStale).toHaveLength(1)
      expect(result.newlyStale[0].isStale).toBe(true)
      expect(result.newlyStale[0].staleReasons).toEqual(['missing entity: auth-service'])

      const reread = readAdrCorpus(repoPath)
      expect(reread?.adrs[0].isStale).toBe(true)
    })

    it('does not flag when all required entities exist (by name)', () => {
      writeAdrCorpus(repoPath, { generatedAt: 't', adrs: [stalenessAdr()] })
      const result = refreshAdrStaleness(repoPath, graphWithServices(['auth-service']))
      expect(result.inspected).toBe(1)
      expect(result.newlyStale).toEqual([])

      const reread = readAdrCorpus(repoPath)
      expect(reread?.adrs[0].isStale).toBeUndefined()
    })

    it('matches by canonical id as well as name', () => {
      writeAdrCorpus(repoPath, {
        generatedAt: 't',
        adrs: [stalenessAdr({ requiredEntities: ['svc-auth-service'] })],
      })
      const result = refreshAdrStaleness(repoPath, graphWithServices(['auth-service']))
      expect(result.newlyStale).toEqual([])
    })

    it('clears the flag when a previously-stale ADR becomes valid again', () => {
      writeAdrCorpus(repoPath, {
        generatedAt: 't',
        adrs: [stalenessAdr({ isStale: true, staleReasons: ['old reason'] })],
      })
      const result = refreshAdrStaleness(repoPath, graphWithServices(['auth-service']))
      expect(result.clearedStale).toHaveLength(1)

      const reread = readAdrCorpus(repoPath)
      expect(reread?.adrs[0].isStale).toBeUndefined()
      expect(reread?.adrs[0].staleReasons).toBeUndefined()
    })

    it('reports all missing entities in staleReasons', () => {
      writeAdrCorpus(repoPath, {
        generatedAt: 't',
        adrs: [stalenessAdr({ requiredEntities: ['auth-service', 'billing-service', 'users-db'] })],
      })
      const result = refreshAdrStaleness(repoPath, graphWithServices(['auth-service']))
      expect(result.newlyStale).toHaveLength(1)
      expect(result.newlyStale[0].staleReasons).toEqual([
        'missing entity: billing-service',
        'missing entity: users-db',
      ])
    })

    it('skips superseded / deprecated ADRs (never flagged stale, strips existing flag)', () => {
      writeAdrCorpus(repoPath, {
        generatedAt: 't',
        adrs: [
          stalenessAdr({ id: 'ADR-0001', status: 'superseded', isStale: true }),
          stalenessAdr({ id: 'ADR-0002', number: 2, status: 'deprecated', isStale: true }),
        ],
      })
      refreshAdrStaleness(repoPath, emptyGraph())
      const reread = readAdrCorpus(repoPath)
      expect(reread?.adrs[0].isStale).toBeUndefined()
      expect(reread?.adrs[1].isStale).toBeUndefined()
    })

    it('does not record newly-stale twice on re-runs', () => {
      writeAdrCorpus(repoPath, { generatedAt: 't', adrs: [stalenessAdr()] })
      const first = refreshAdrStaleness(repoPath, emptyGraph())
      expect(first.newlyStale).toHaveLength(1)

      const second = refreshAdrStaleness(repoPath, emptyGraph())
      expect(second.newlyStale).toEqual([])
    })
  })
})

// ===========================================================================
// Living Fragments (M11)
// ===========================================================================

import {
  captureFragmentSnapshot,
  extractFragmentsFromBody,
} from '../../apps/server/src/lib/adr-store'

// Module-level helpers for fragment tests (the staleness describe has its
// own copies scoped to that block — kept separate for readability).
function fragEmptyGraph(): Graph {
  return {
    services: [], serviceDependencies: [], layers: [], modules: [],
    methods: [], moduleDeps: [], methodDeps: [], databases: [],
    databaseConnections: [], flows: [],
  }
}
function fragGraphWithServices(names: string[]): Graph {
  const g = fragEmptyGraph()
  g.services = names.map((n) => ({
    id: `svc-${n}`, name: n, rootPath: `/${n}`, type: 'api-server',
    framework: null, fileCount: 1, description: null, layerSummary: null,
  }))
  return g
}

describe('extractFragmentsFromBody', () => {
  it('parses an adr-graph fenced block', () => {
    const body =
      '## Context\n' +
      'Some context.\n\n' +
      '```adr-graph\n' +
      'services: [auth-service, billing-service]\n' +
      'show: dependencies\n' +
      '```\n\n' +
      '## Decision\nA decision.\n'
    const fragments = extractFragmentsFromBody(body)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].kind).toBe('graph')
    expect((fragments[0].locator as { services?: string[] }).services).toEqual([
      'auth-service',
      'billing-service',
    ])
    expect((fragments[0].locator as { show?: string }).show).toBe('dependencies')
  })

  it('parses an adr-flow fenced block', () => {
    const body = '```adr-flow\nflowId: user-registration\n```\n'
    const fragments = extractFragmentsFromBody(body)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].kind).toBe('flow')
    expect((fragments[0].locator as { flowId: string }).flowId).toBe('user-registration')
  })

  it('handles multiple fragments in one body', () => {
    const body =
      '```adr-graph\nservices: [a]\n```\n\n' +
      'some prose\n\n' +
      '```adr-flow\nflowId: f1\n```\n'
    const fragments = extractFragmentsFromBody(body)
    expect(fragments.map((f) => f.kind)).toEqual(['graph', 'flow'])
  })

  it('skips malformed blocks silently and keeps the body intact (caller keeps the fence text)', () => {
    // adr-flow block missing required `flowId`
    const body =
      '```adr-flow\nwrongKey: nope\n```\n\n' +
      '```adr-graph\nservices: [a]\n```\n'
    const fragments = extractFragmentsFromBody(body)
    // The malformed block is skipped; the valid graph block still parses.
    expect(fragments).toHaveLength(1)
    expect(fragments[0].kind).toBe('graph')
  })

  it('ignores non-fragment fenced blocks', () => {
    const body = '```ts\nconst x = 1\n```\n\n```\nplain code\n```\n'
    expect(extractFragmentsFromBody(body)).toEqual([])
  })
})

describe('captureFragmentSnapshot — graph', () => {
  it('captures nodes + edges for known services', () => {
    const graph = fragGraphWithServices(['auth-service', 'billing-service'])
    // Seed one service→service dep
    graph.serviceDependencies = [
      {
        id: 'dep-1',
        sourceServiceId: 'svc-auth-service',
        targetServiceId: 'svc-billing-service',
        dependencyCount: 3,
        dependencyType: null,
      },
    ]
    const [fragment] = extractFragmentsFromBody(
      '```adr-graph\nservices: [auth-service, billing-service]\n```\n',
    )
    const snap = captureFragmentSnapshot(fragment, graph)
    expect(snap?.kind).toBe('graph')
    if (snap?.kind !== 'graph') throw new Error('expected graph')
    expect(snap.nodes.map((n) => n.name).sort()).toEqual(['auth-service', 'billing-service'])
    expect(snap.edges).toHaveLength(1)
    expect(snap.edges[0]).toMatchObject({
      source: 'auth-service',
      target: 'billing-service',
      count: 3,
    })
    expect(snap.graphHash).toMatch(/^-?[0-9a-z]+$/)
  })

  it('returns null when no referenced services resolve', () => {
    const graph = fragGraphWithServices(['real-service'])
    const [fragment] = extractFragmentsFromBody(
      '```adr-graph\nservices: [ghost-service]\n```\n',
    )
    expect(captureFragmentSnapshot(fragment, graph)).toBeNull()
  })
})

describe('captureFragmentSnapshot — flow', () => {
  function graphWithFlow(): Graph {
    const g = fragGraphWithServices(['a', 'b'])
    g.flows = [
      {
        id: 'flow-1',
        name: 'user-registration',
        description: null,
        entryService: 'a',
        entryMethod: 'register',
        category: 'auth',
        trigger: 'http',
        stepCount: 2,
        steps: [
          {
            stepOrder: 1,
            sourceService: 'a',
            sourceModule: 'm',
            sourceMethod: 'register',
            targetService: 'b',
            targetModule: 'n',
            targetMethod: 'createAccount',
            stepType: 'http',
            dataDescription: null,
            isAsync: false,
            isConditional: false,
          },
          {
            stepOrder: 2,
            sourceService: 'b',
            sourceModule: 'n',
            sourceMethod: 'createAccount',
            targetService: 'a',
            targetModule: 'm',
            targetMethod: 'finalize',
            stepType: 'call',
            dataDescription: null,
            isAsync: false,
            isConditional: false,
          },
        ],
      },
    ]
    return g
  }

  it('captures flow steps for a known flow id/name', () => {
    const [fragment] = extractFragmentsFromBody(
      '```adr-flow\nflowId: user-registration\n```\n',
    )
    const snap = captureFragmentSnapshot(fragment, graphWithFlow())
    if (snap?.kind !== 'flow') throw new Error('expected flow')
    expect(snap.flowName).toBe('user-registration')
    expect(snap.steps).toHaveLength(2)
    expect(snap.steps[0]).toMatchObject({
      stepOrder: 1,
      sourceService: 'a',
      targetService: 'b',
      stepType: 'http',
    })
  })

  it('honors fromStep / toStep slicing', () => {
    const [fragment] = extractFragmentsFromBody(
      '```adr-flow\nflowId: user-registration\nfromStep: 2\n```\n',
    )
    const snap = captureFragmentSnapshot(fragment, graphWithFlow())
    if (snap?.kind !== 'flow') throw new Error('expected flow')
    expect(snap.steps.map((s) => s.stepOrder)).toEqual([2])
  })

  it('returns null when the flow id is unknown', () => {
    const [fragment] = extractFragmentsFromBody('```adr-flow\nflowId: ghost-flow\n```\n')
    expect(captureFragmentSnapshot(fragment, graphWithFlow())).toBeNull()
  })
})

describe('refreshAdrStaleness — fragments', () => {
  function stalenessAdrWithFragment(
    overrides: Partial<Adr> = {},
    fragmentOverride?: Partial<import('../../packages/shared/src/types/adr').FragmentSnapshot>,
  ) {
    const entry = {
      id: 'ADR-0001',
      number: 1,
      title: 'Use event bus',
      status: 'accepted' as const,
      date: '2026-04-21',
      path: 'docs/adr/ADR-0001-use-event-bus.md',
      linkedNodeIds: [] as string[],
      requiredEntities: [] as string[],
      ...overrides,
    }
    const fragment = {
      kind: 'graph' as const,
      locator: { services: ['auth-service', 'billing-service'] },
      capturedAt: '2026-04-21T00:00:00Z',
      nodes: [
        { id: 'svc-auth-service', name: 'auth-service', kind: 'service' as const },
        { id: 'svc-billing-service', name: 'billing-service', kind: 'service' as const },
      ],
      edges: [],
      graphHash: 'h1',
      ...fragmentOverride,
    }
    return { ...entry, fragments: [fragment] }
  }

  it('flags stale when a fragment node is removed from the graph', () => {
    writeAdrCorpus(repoPath, {
      generatedAt: 't',
      adrs: [stalenessAdrWithFragment()],
    })
    const result = refreshAdrStaleness(repoPath, fragGraphWithServices(['auth-service']))
    expect(result.newlyStale).toHaveLength(1)
    expect(result.newlyStale[0].staleReasons).toContain(
      'fragment references removed entity: billing-service',
    )
  })

  it('does not flag stale when all fragment nodes still exist (drift allowed)', () => {
    writeAdrCorpus(repoPath, {
      generatedAt: 't',
      adrs: [stalenessAdrWithFragment()],
    })
    const graph = fragGraphWithServices(['auth-service', 'billing-service'])
    // Add an edge that wasn't in the snapshot (drift, not staleness)
    graph.serviceDependencies = [
      {
        id: 'dep-new',
        sourceServiceId: 'svc-billing-service',
        targetServiceId: 'svc-auth-service',
        dependencyCount: 1,
        dependencyType: null,
      },
    ]
    const result = refreshAdrStaleness(repoPath, graph)
    expect(result.newlyStale).toEqual([])
  })

  it('flags stale when an adr-flow fragment references a removed flow', () => {
    const entry = stalenessAdrWithFragment(
      { id: 'ADR-0002', number: 2 },
      {
        kind: 'flow' as const,
        locator: { flowId: 'ghost-flow' },
        capturedAt: '2026-04-21T00:00:00Z',
        flowName: 'ghost-flow',
        steps: [],
        graphHash: 'h2',
      } as Partial<import('../../packages/shared/src/types/adr').FragmentSnapshot>,
    )
    writeAdrCorpus(repoPath, { generatedAt: 't', adrs: [entry] })
    const result = refreshAdrStaleness(repoPath, fragGraphWithServices(['auth-service']))
    expect(result.newlyStale).toHaveLength(1)
    expect(result.newlyStale[0].staleReasons).toContain(
      'fragment references removed flow: ghost-flow',
    )
  })
})
