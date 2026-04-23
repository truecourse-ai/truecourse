import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import type { Express } from 'express'

// Mock socket + suggester at the module boundary: these routes are pure thin
// wrappers over library functions and socket emitters. Mocking them keeps
// the test fast (no CLI spawn, no real Socket.io server) and deterministic.
vi.mock('../../apps/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/server/src/socket/handlers')>()
  return {
    ...actual,
    emitAdrSuggestEvent: vi.fn(),
  }
})
vi.mock('../../apps/server/src/services/llm/adr-suggester', () => ({
  suggestAdrsInProcess: vi.fn().mockResolvedValue({
    drafts: [],
    dropped: [],
    surveyCandidateCount: 0,
  }),
}))
vi.mock('../../apps/server/src/services/llm/provider', () => ({
  createLLMProvider: () => ({
    setRepoPath: () => {},
    setRepoId: () => {},
    setAnalysisId: () => {},
    setAbortSignal: () => {},
    flushUsage: () => [],
  }),
}))

import { createApp } from '../../apps/server/src/app'
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db'
import {
  clearLatestCache,
  writeLatest,
} from '../../apps/server/src/lib/analysis-store'
import {
  writeAdrCorpus,
  writeAdrDraft,
  readRejectedSignatures,
  readAdrCorpus,
  listAdrDrafts,
  readAdrDraft,
  clearAdrCorpusCache,
} from '../../apps/server/src/lib/adr-store'
import type { Adr, AdrDraft } from '../../packages/shared/src/types/adr'
import type { LatestSnapshot, Graph } from '../../apps/server/src/types/snapshot'
import { suggestAdrsInProcess } from '../../apps/server/src/services/llm/adr-suggester'

let fixture: TestFixture
let app: Express

function emptyGraph(): Graph {
  return {
    services: [], serviceDependencies: [], layers: [], modules: [],
    methods: [], moduleDeps: [], methodDeps: [], databases: [],
    databaseConnections: [], flows: [],
  }
}

function makeLatest(): LatestSnapshot {
  return {
    head: 'head.json',
    analysis: {
      id: 'a1',
      createdAt: '2026-04-21T00:00:00Z',
      branch: 'main',
      commitHash: 'abc',
      architecture: 'monolith',
      metadata: null,
      status: 'completed',
    },
    graph: emptyGraph(),
    violations: [],
  }
}

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

beforeEach(async () => {
  fixture = await setupTestFixture()
  app = createApp({ serveStatic: false })
  clearLatestCache()
  clearAdrCorpusCache()
  vi.mocked(suggestAdrsInProcess).mockClear()
})

afterEach(async () => {
  await teardownTestFixture(fixture.project.slug)
})

// ---------------------------------------------------------------------------
// GET endpoints
// ---------------------------------------------------------------------------

describe('ADR routes — reads', () => {
  it('GET /adrs returns the corpus', async () => {
    writeAdrCorpus(fixture.repoPath, { generatedAt: 't', adrs: [makeAdr()] })
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs`)
    expect(res.status).toBe(200)
    expect(res.body.adrs).toHaveLength(1)
    expect(res.body.adrs[0].id).toBe('ADR-0001')
    expect(res.body.generatedAt).toBe('t')
  })

  it('GET /adrs returns [] when corpus is absent', async () => {
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs`)
    expect(res.status).toBe(200)
    expect(res.body.adrs).toEqual([])
  })

  it('GET /adrs/drafts returns pending drafts', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs/drafts`)
    expect(res.status).toBe(200)
    expect(res.body.drafts).toHaveLength(1)
    expect(res.body.drafts[0].id).toBe('draft-abc')
  })

  it('GET /adrs/:adrId returns a single ADR (loads sections from disk)', async () => {
    const adr = makeAdr()
    writeAdrCorpus(fixture.repoPath, { generatedAt: 't', adrs: [adr] })
    // The detail endpoint now reads the MADR file from disk — seed it.
    const abs = path.join(fixture.repoPath, adr.path)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(
      abs,
      '---\nstatus: accepted\ndate: 2026-04-21\n---\n\n' +
        '# ADR-0001: Use event bus\n\n' +
        '## Context\nc\n\n## Decision\nd\n\n## Consequences\nq\n',
      'utf-8',
    )

    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs/ADR-0001`)
    expect(res.status).toBe(200)
    expect(res.body.adr.id).toBe('ADR-0001')
    expect(res.body.adr.sections).toBeDefined()
  })

  it('GET /adrs/:adrId returns 410 when index is stale (file missing)', async () => {
    const adr = makeAdr()
    writeAdrCorpus(fixture.repoPath, { generatedAt: 't', adrs: [adr] })
    // Deliberately DO NOT write the .md file.
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs/ADR-0001`)
    expect(res.status).toBe(410)
  })

  it('GET /adrs/:adrId returns 404 on unknown id', async () => {
    writeAdrCorpus(fixture.repoPath, { generatedAt: 't', adrs: [] })
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs/ADR-9999`)
    expect(res.status).toBe(404)
  })

  it('GET /adrs/stale returns only stale records', async () => {
    writeAdrCorpus(fixture.repoPath, {
      generatedAt: 't',
      adrs: [
        makeAdr({ id: 'ADR-0001' }),
        makeAdr({ id: 'ADR-0002', number: 2, isStale: true }),
      ],
    })
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/adrs/stale`)
    expect(res.status).toBe(200)
    expect(res.body.adrs.map((a: Adr) => a.id)).toEqual(['ADR-0002'])
  })
})

// ---------------------------------------------------------------------------
// Suggest
// ---------------------------------------------------------------------------

describe('POST /adrs/suggest', () => {
  it('returns 409 when no analysis exists', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/suggest`)
      .send({})
    expect(res.status).toBe(409)
  })

  it('returns a runId and calls suggestAdrsInProcess with resolved options', async () => {
    writeLatest(fixture.repoPath, makeLatest())
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/suggest`)
      .send({ max: 3, threshold: 0.4, topicHint: 'focus on data' })
    expect(res.status).toBe(200)
    expect(res.body.runId).toMatch(/^[0-9a-f-]+$/)

    // suggestAdrsInProcess is async/fire-and-forget — wait a tick
    await new Promise((r) => setTimeout(r, 50))
    expect(suggestAdrsInProcess).toHaveBeenCalledTimes(1)
    const call = vi.mocked(suggestAdrsInProcess).mock.calls[0]![0]
    expect(call.repoPath).toBe(fixture.repoPath)
    expect(call.maxDrafts).toBe(3)
    expect(call.threshold).toBe(0.4)
    expect(call.topicHint).toBe('focus on data')
  })
})

// ---------------------------------------------------------------------------
// Accept / reject / edit
// ---------------------------------------------------------------------------

describe('POST /adrs/drafts/:id/accept', () => {
  it('promotes the draft to an ADR file + corpus record', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/drafts/draft-abc/accept`)
    expect(res.status).toBe(200)
    expect(res.body.adr.id).toBe('ADR-0001')
    expect(fs.existsSync(res.body.filePath)).toBe(true)
    expect(listAdrDrafts(fixture.repoPath)).toEqual([])
    expect(readAdrCorpus(fixture.repoPath)?.adrs.map((a) => a.id)).toEqual(['ADR-0001'])
  })

  it('respects a configured adr output path', async () => {
    const configPath = path.join(fixture.repoPath, '.truecourse/config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({ adr: { path: 'architecture/decisions' } }),
      'utf-8',
    )
    writeAdrDraft(fixture.repoPath, makeDraft())
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/drafts/draft-abc/accept`)
    expect(res.status).toBe(200)
    expect(res.body.filePath).toContain('architecture/decisions')
  })

  it('returns 404 on unknown draft id', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/drafts/ghost/accept`)
    expect(res.status).toBe(404)
  })
})

describe('POST /adrs/drafts/:id/reject', () => {
  it('persists the draft signature and deletes the draft', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/drafts/draft-abc/reject`)
    expect(res.status).toBe(200)
    expect(res.body.signature.topic).toBe('circular-dependency')
    expect(readRejectedSignatures(fixture.repoPath)).toHaveLength(1)
    expect(readAdrDraft(fixture.repoPath, 'draft-abc')).toBeNull()
  })
})

describe('PUT /adrs/drafts/:id', () => {
  function serialize(draft: ReturnType<typeof makeDraft>, overrides: { title?: string } = {}): string {
    const title = overrides.title ?? draft.title
    return [
      '---',
      'status: proposed',
      'date: 2026-04-22',
      `title: ${title}`,
      `topic: ${draft.topic}`,
      `entities: ${JSON.stringify(draft.entities)}`,
      `confidence: ${draft.confidence}`,
      `draft-id: ${draft.id}`,
      `created-at: ${draft.createdAt}`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Context',
      'Here is the context.',
      '',
      '## Decision',
      'Here is the decision.',
      '',
      '## Consequences',
      'Here are the consequences.',
      '',
    ].join('\n')
  }

  it('replaces the full MADR source and reparses', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const source = serialize(makeDraft(), { title: 'Updated title' })
    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/adrs/drafts/draft-abc`)
      .send({ source })
    expect(res.status).toBe(200)
    expect(res.body.draft.title).toBe('Updated title')
    expect(readAdrDraft(fixture.repoPath, 'draft-abc')?.title).toBe('Updated title')
  })

  it('rejects empty source', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/adrs/drafts/draft-abc`)
      .send({ source: '' })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('refuses raw edits that change the draft-id', async () => {
    writeAdrDraft(fixture.repoPath, makeDraft())
    const source = serialize(makeDraft()).replace('draft-id: draft-abc', 'draft-id: draft-xyz')
    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/adrs/drafts/draft-abc`)
      .send({ source })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

// ---------------------------------------------------------------------------
// Link / unlink
// ---------------------------------------------------------------------------

describe('POST /adrs/:adrId/link / DELETE /adrs/:adrId/link/:nodeId', () => {
  beforeEach(() => {
    writeAdrCorpus(fixture.repoPath, {
      generatedAt: 't',
      adrs: [makeAdr({ linkedNodeIds: ['svc-a'] })],
    })
  })

  it('adds a link', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/ADR-0001/link`)
      .send({ nodeId: 'svc-b' })
    expect(res.status).toBe(200)
    expect(res.body.adr.linkedNodeIds.sort()).toEqual(['svc-a', 'svc-b'])
  })

  it('is idempotent on duplicate add', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/ADR-0001/link`)
      .send({ nodeId: 'svc-a' })
    expect(res.body.adr.linkedNodeIds).toEqual(['svc-a'])
  })

  it('removes a link', async () => {
    const res = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/adrs/ADR-0001/link/svc-a`)
    expect(res.status).toBe(200)
    expect(res.body.adr.linkedNodeIds).toEqual([])
  })

  it('returns 404 on unknown ADR', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/adrs/ADR-9999/link`)
      .send({ nodeId: 'svc-a' })
    expect(res.status).toBe(404)
  })
})
