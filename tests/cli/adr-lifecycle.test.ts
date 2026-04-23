import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Stub socket emitters so library calls don't need a running Socket.io server.
vi.mock('../../apps/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/server/src/socket/handlers')>()
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
  }
})

import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db'
import {
  writeAdrCorpus,
  writeAdrDraft,
  readAdrCorpus,
  readRejectedSignatures,
  listAdrDrafts,
  clearAdrCorpusCache,
} from '../../apps/server/src/lib/adr-store'
import type { Adr, AdrDraft } from '../../packages/shared/src/types/adr'
import {
  runAdrAccept,
  runAdrDrafts,
  runAdrLink,
  runAdrList,
  runAdrReject,
  runAdrShow,
  runAdrStale,
  runAdrUnlink,
} from '../../tools/cli/src/commands/adr'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let fixture: TestFixture
let origCwd: string
let stdoutBuf: string

function makeAdr(overrides: Partial<Adr> = {}): Adr {
  return {
    id: 'ADR-0001',
    number: 1,
    title: 'Use event bus',
    status: 'accepted',
    date: '2026-04-21',
    path: 'docs/adr/ADR-0001-use-event-bus.md',
    sections: { context: 'c', decision: 'd', consequences: 'q' },
    linkedNodeIds: ['svc-a'],
    requiredEntities: ['svc-a'],
    ...overrides,
  }
}

function makeDraft(overrides: Partial<AdrDraft> = {}): AdrDraft {
  return {
    id: 'draft-abc',
    createdAt: '2026-04-21T10:00:00Z',
    title: 'A draft',
    topic: 'circular-dependency',
    entities: ['svc-a', 'svc-b'],
    madrBody:
      '# ADR-XXXX: A draft\n\n## Context\nc\n\n## Decision\nd\n\n## Consequences\nq\n',
    confidence: 0.8,
    ...overrides,
  }
}

let origLog: typeof console.log

function captureStdout(): () => string {
  stdoutBuf = ''
  origLog = console.log
  console.log = (...args: unknown[]) => {
    stdoutBuf += args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ') + '\n'
  }
  return () => {
    console.log = origLog
    return stdoutBuf
  }
}

beforeEach(async () => {
  fixture = await setupTestFixture()
  origCwd = process.cwd()
  process.chdir(fixture.repoPath)
  clearAdrCorpusCache()
})

afterEach(async () => {
  process.chdir(origCwd)
  await teardownTestFixture(fixture.project.slug)
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// list / show / drafts / stale
// ---------------------------------------------------------------------------

describe('runAdrList', () => {
  it('returns empty list gracefully in JSON mode', async () => {
    const stop = captureStdout()
    await runAdrList({ json: true })
    const out = stop()
    expect(JSON.parse(out)).toEqual({ adrs: [] })
  })

  it('prints accepted ADRs to JSON', async () => {
    writeAdrCorpus(fixture.repoPath, { generatedAt: 't', adrs: [makeAdr()] })
    const stop = captureStdout()
    await runAdrList({ json: true })
    const out = JSON.parse(stop())
    expect(out.adrs).toHaveLength(1)
    expect(out.adrs[0].id).toBe('ADR-0001')
  })

  it('filters by --linked-to', async () => {
    writeAdrCorpus(fixture.repoPath, {
      generatedAt: 't',
      adrs: [
        makeAdr({ id: 'ADR-0001', linkedNodeIds: ['svc-a'] }),
        makeAdr({ id: 'ADR-0002', number: 2, linkedNodeIds: ['svc-b'] }),
      ],
    })
    const stop = captureStdout()
    await runAdrList({ json: true, linkedTo: 'svc-b' })
    const out = JSON.parse(stop())
    expect(out.adrs.map((a: Adr) => a.id)).toEqual(['ADR-0002'])
  })
})

describe('runAdrShow', () => {
  it('prints the ADR in JSON mode', async () => {
    const adr = makeAdr()
    writeAdrCorpus(fixture.repoPath, { generatedAt: 't', adrs: [adr] })
    // runAdrShow loads the MADR file from disk — seed it.
    const abs = path.join(fixture.repoPath, adr.path)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(
      abs,
      '---\nstatus: accepted\ndate: 2026-04-21\n---\n\n' +
        '# ADR-0001: Use event bus\n\n' +
        '## Context\nc\n\n## Decision\nd\n\n## Consequences\nq\n',
      'utf-8',
    )
    const stop = captureStdout()
    await runAdrShow('ADR-0001', { json: true })
    const out = JSON.parse(stop())
    expect(out.adr.id).toBe('ADR-0001')
  })
})

describe('runAdrDrafts', () => {
  it('returns empty list in JSON mode when no drafts', async () => {
    const stop = captureStdout()
    await runAdrDrafts({ json: true })
    const out = stop()
    expect(JSON.parse(out)).toEqual({ drafts: [] })
  })

  it('lists pending drafts', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const stop = captureStdout()
    await runAdrDrafts({ json: true })
    const out = JSON.parse(stop())
    expect(out.drafts).toHaveLength(1)
    expect(out.drafts[0].id).toBe('draft-abc')
  })
})

describe('runAdrStale', () => {
  it('returns only stale ADRs', async () => {
    writeAdrCorpus(fixture.repoPath, {
      generatedAt: 't',
      adrs: [makeAdr({ id: 'ADR-0001' }), makeAdr({ id: 'ADR-0002', number: 2, isStale: true })],
    })
    const stop = captureStdout()
    await runAdrStale({ json: true })
    const out = JSON.parse(stop())
    expect(out.adrs.map((a: Adr) => a.id)).toEqual(['ADR-0002'])
  })
})

// ---------------------------------------------------------------------------
// accept / reject (mutations)
// ---------------------------------------------------------------------------

describe('runAdrAccept', () => {
  it('promotes the draft to an accepted ADR file', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    await runAdrAccept('draft-abc')
    expect(listAdrDrafts(fixture.repoPath)).toEqual([])
    const corpus = readAdrCorpus(fixture.repoPath)
    expect(corpus?.adrs.map((a) => a.id)).toEqual(['ADR-0001'])
    const filePath = path.join(fixture.repoPath, 'docs/adr/ADR-0001-a-draft.md')
    expect(fs.existsSync(filePath)).toBe(true)
  })
})

describe('runAdrReject', () => {
  it('persists signature and deletes draft', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    await runAdrReject('draft-abc')
    expect(readRejectedSignatures(fixture.repoPath)).toHaveLength(1)
    expect(listAdrDrafts(fixture.repoPath)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// link / unlink
// ---------------------------------------------------------------------------

describe('runAdrLink / runAdrUnlink', () => {
  beforeEach(() => {
    writeAdrCorpus(fixture.repoPath, {
      generatedAt: 't',
      adrs: [makeAdr({ linkedNodeIds: ['svc-a'] })],
    })
  })

  it('adds a link', async () => {
    await runAdrLink('ADR-0001', 'svc-b')
    const corpus = readAdrCorpus(fixture.repoPath)
    expect(corpus?.adrs[0].linkedNodeIds.sort()).toEqual(['svc-a', 'svc-b'])
  })

  it('removes a link', async () => {
    await runAdrUnlink('ADR-0001', 'svc-a')
    const corpus = readAdrCorpus(fixture.repoPath)
    expect(corpus?.adrs[0].linkedNodeIds).toEqual([])
  })
})
