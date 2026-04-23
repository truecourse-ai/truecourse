import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  acceptAdrDraft,
  extractSectionsFromMadrBody,
  formatAdrId,
  nextAdrNumber,
  slugify,
} from '../../apps/server/src/lib/adr-writer'
import {
  clearAdrCorpusCache,
  listAdrDrafts,
  readAdrCorpus,
  writeAdrDraft,
} from '../../apps/server/src/lib/adr-store'
import { getDefaultAdrOutputDir } from '../../apps/server/src/config/paths'
import type { AdrDraft } from '../../packages/shared/src/types/adr'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-adr-writer-'))
  clearAdrCorpusCache()
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// slugify / formatAdrId
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases, strips punctuation, and joins with hyphens', () => {
    expect(slugify('Use Event Bus for Cross-Service Communication'))
      .toBe('use-event-bus-for-cross-service-communication')
  })

  it('strips non-alphanumerics except hyphens', () => {
    expect(slugify('Migrate to PostgreSQL (2026)')).toBe('migrate-to-postgresql-2026')
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(slugify('  Too   Many    Spaces ')).toBe('too-many-spaces')
  })

  it('returns "adr" for titles that slugify to empty', () => {
    expect(slugify('???')).toBe('adr')
    expect(slugify('')).toBe('adr')
  })
})

describe('formatAdrId', () => {
  it('pads to four digits', () => {
    expect(formatAdrId(1)).toBe('ADR-0001')
    expect(formatAdrId(42)).toBe('ADR-0042')
    expect(formatAdrId(9999)).toBe('ADR-9999')
    expect(formatAdrId(10000)).toBe('ADR-10000')
  })
})

// ---------------------------------------------------------------------------
// nextAdrNumber
// ---------------------------------------------------------------------------

describe('nextAdrNumber', () => {
  it('returns 1 when the directory is absent', () => {
    expect(nextAdrNumber(path.join(repoPath, 'does-not-exist'))).toBe(1)
  })

  it('returns 1 when the directory is empty', () => {
    const dir = path.join(repoPath, 'docs', 'adr')
    fs.mkdirSync(dir, { recursive: true })
    expect(nextAdrNumber(dir)).toBe(1)
  })

  it('returns max + 1 across existing files', () => {
    const dir = path.join(repoPath, 'docs', 'adr')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'ADR-0001-foo.md'), 'x')
    fs.writeFileSync(path.join(dir, 'ADR-0003-bar.md'), 'x')  // gap at 0002
    fs.writeFileSync(path.join(dir, 'README.md'), 'x')         // ignored
    expect(nextAdrNumber(dir)).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// extractSectionsFromMadrBody
// ---------------------------------------------------------------------------

describe('extractSectionsFromMadrBody', () => {
  it('extracts all three sections from a well-formed body', () => {
    const body = `# ADR-XXXX: Foo

## Context
Context prose.

## Decision
Decision prose.

## Consequences
Consequences prose.
`
    const sections = extractSectionsFromMadrBody(body)
    expect(sections).toEqual({
      context: 'Context prose.',
      decision: 'Decision prose.',
      consequences: 'Consequences prose.',
    })
  })

  it('throws when a required section is missing', () => {
    const body = '# ADR-XXXX: Foo\n\n## Context\nc\n## Decision\nd\n'
    expect(() => extractSectionsFromMadrBody(body)).toThrowError(/consequences=false/)
  })
})

// ---------------------------------------------------------------------------
// acceptAdrDraft
// ---------------------------------------------------------------------------

function makeDraft(overrides: Partial<AdrDraft> = {}): AdrDraft {
  return {
    id: 'draft-abc',
    createdAt: '2026-04-21T10:00:00.000Z',
    title: 'Use event bus',
    topic: 'communication-pattern',
    entities: ['auth-service', 'billing-service'],
    madrBody:
      '# ADR-XXXX: Use event bus\n\n' +
      '## Context\nServices are growing; HTTP is tangled.\n\n' +
      '## Decision\nIntroduce an event bus.\n\n' +
      '## Consequences\nOps complexity up; coupling down.\n',
    confidence: 0.8,
    ...overrides,
  }
}

describe('acceptAdrDraft', () => {
  it('writes ADR-0001 in a fresh repo and upserts corpus', async () => {
    const draft = makeDraft()
    writeAdrDraft(repoPath, draft)                    // simulate the review queue

    const { adr, filePath } = await acceptAdrDraft({ repoPath, draft })

    expect(adr.id).toBe('ADR-0001')
    expect(adr.number).toBe(1)
    expect(adr.title).toBe('Use event bus')
    expect(adr.status).toBe('accepted')
    expect(adr.linkedNodeIds).toEqual(['auth-service', 'billing-service'])
    expect(adr.requiredEntities).toEqual(['auth-service', 'billing-service'])
    expect(adr.sourceDraftId).toBe('draft-abc')

    // File on disk
    const expectedPath = path.join(
      getDefaultAdrOutputDir(repoPath),
      'ADR-0001-use-event-bus.md',
    )
    expect(filePath).toBe(expectedPath)
    expect(fs.existsSync(expectedPath)).toBe(true)
    expect(fs.readFileSync(expectedPath, 'utf-8')).toContain('# ADR-0001: Use event bus')

    // Corpus has the record
    const corpus = readAdrCorpus(repoPath)
    expect(corpus?.adrs.map((a) => a.id)).toEqual(['ADR-0001'])

    // Draft is gone
    expect(listAdrDrafts(repoPath)).toEqual([])
  })

  it('assigns the next number when ADRs already exist', async () => {
    // Seed existing ADRs on disk.
    const outputDir = getDefaultAdrOutputDir(repoPath)
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(path.join(outputDir, 'ADR-0001-a.md'), 'x')
    fs.writeFileSync(path.join(outputDir, 'ADR-0003-b.md'), 'x')  // gap

    const draft = makeDraft({ title: 'Split auth service' })
    writeAdrDraft(repoPath, draft)

    const { adr, filePath } = await acceptAdrDraft({ repoPath, draft })
    expect(adr.id).toBe('ADR-0004')   // max + 1, not 0002
    expect(filePath.endsWith('ADR-0004-split-auth-service.md')).toBe(true)
  })

  it('respects an outputDir override', async () => {
    const outputDir = path.join(repoPath, 'architecture', 'decisions')
    const draft = makeDraft()
    writeAdrDraft(repoPath, draft)

    const { filePath } = await acceptAdrDraft({ repoPath, draft, outputDir })
    expect(filePath.startsWith(outputDir)).toBe(true)
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('throws if the LLM body is missing a required section', async () => {
    const bad = makeDraft({
      madrBody: '# ADR-XXXX: Foo\n\n## Context\nctx\n## Decision\ndec\n',
    })
    writeAdrDraft(repoPath, bad)
    await expect(acceptAdrDraft({ repoPath, draft: bad })).rejects.toThrow(/consequences/i)

    // Nothing was written to docs/adr/
    const outputDir = getDefaultAdrOutputDir(repoPath)
    const existing = fs.existsSync(outputDir) ? fs.readdirSync(outputDir) : []
    expect(existing).toEqual([])
  })

  it('rejects `stale` status — it is computed-only', async () => {
    const draft = makeDraft()
    writeAdrDraft(repoPath, draft)
    await expect(
      acceptAdrDraft({ repoPath, draft, status: 'stale' }),
    ).rejects.toThrow(/computed status/)
  })

  it('preserves existing ADRs in the corpus on accept', async () => {
    // First accept
    writeAdrDraft(repoPath, makeDraft({ id: 'd1', title: 'First' }))
    await acceptAdrDraft({ repoPath, draft: makeDraft({ id: 'd1', title: 'First' }) })

    // Second accept
    writeAdrDraft(repoPath, makeDraft({ id: 'd2', title: 'Second', entities: ['auth-service'] }))
    await acceptAdrDraft({ repoPath, draft: makeDraft({ id: 'd2', title: 'Second', entities: ['auth-service'] }) })

    const corpus = readAdrCorpus(repoPath)
    expect(corpus?.adrs.map((a) => a.id).sort()).toEqual(['ADR-0001', 'ADR-0002'])
  })
})
