import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  appendRejected,
  checkpointPath,
  clearAllDrafts,
  deleteDraft,
  invariantsDir,
  listActiveInvariantSlugs,
  listDrafts,
  readActiveInvariant,
  readAllActiveInvariants,
  readCheckpoint,
  readDraft,
  readRejected,
  rejectedSignatureSet,
  retireInvariant,
  writeActiveInvariant,
  writeCheckpoint,
  writeDraft,
} from '../../packages/core/src/lib/invariant-store'
import type {
  Invariant,
  InvariantCheckpoint,
  InvariantDraft,
} from '../../packages/shared/src/types/invariants'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-invariant-store-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function makeInvariant(overrides: Partial<Invariant> = {}): Invariant {
  return {
    id: randomUUID(),
    type: 'state-machine',
    pluginVersion: 1,
    scope: 'Order.status',
    declaration: { states: ['draft', 'placed'], terminal: ['placed'] },
    provenance: {
      source: 'discovered',
      inputs: ['code'],
      timestamp: '2026-04-25T10:00:00Z',
    },
    ...overrides,
  }
}

function makeDraft(overrides: Partial<InvariantDraft> = {}): InvariantDraft {
  return {
    id: randomUUID(),
    type: 'state-machine',
    pluginVersion: 1,
    scope: 'Order.status',
    declaration: { states: ['draft', 'placed'] },
    provenance: {
      source: 'discovered',
      inputs: ['code'],
      timestamp: '2026-04-25T10:00:00Z',
    },
    rationale: 'observed in 7 write sites',
    confidence: 0.85,
    ...overrides,
  }
}

describe('invariant-store: active invariants', () => {
  it('writes and reads back an active invariant', () => {
    const inv = makeInvariant()
    writeActiveInvariant(repoPath, 'state-machine__order-status', inv)
    const read = readActiveInvariant(repoPath, 'state-machine__order-status')
    expect(read).toBeTruthy()
    expect(read!.id).toBe(inv.id)
    expect(read!.scope).toBe('Order.status')
    expect(read!.sourceFile).toMatch(/state-machine__order-status\.yaml$/)
  })

  it('lists active invariant slugs', () => {
    writeActiveInvariant(repoPath, 'state-machine__order', makeInvariant())
    writeActiveInvariant(repoPath, 'ordering__feed', makeInvariant({ type: 'ordering' }))
    expect(listActiveInvariantSlugs(repoPath).sort()).toEqual([
      'ordering__feed',
      'state-machine__order',
    ])
  })

  it('reads all active invariants', () => {
    writeActiveInvariant(repoPath, 'a', makeInvariant({ scope: 'A' }))
    writeActiveInvariant(repoPath, 'b', makeInvariant({ scope: 'B' }))
    const all = readAllActiveInvariants(repoPath)
    expect(all).toHaveLength(2)
    expect(all.map((i) => i.scope).sort()).toEqual(['A', 'B'])
  })

  it('retires an active invariant', () => {
    writeActiveInvariant(repoPath, 'gone', makeInvariant())
    expect(retireInvariant(repoPath, 'gone')).toBe(true)
    expect(readActiveInvariant(repoPath, 'gone')).toBeNull()
    expect(retireInvariant(repoPath, 'gone')).toBe(false)
  })

  it('writes are atomic (no partial files visible after crash)', () => {
    writeActiveInvariant(repoPath, 'atomic', makeInvariant())
    const tmpFiles = fs.readdirSync(invariantsDir(repoPath)).filter((f) => f.includes('.tmp-'))
    expect(tmpFiles).toEqual([])
  })

  it('rejects malformed invariants on read', () => {
    const malformedPath = path.join(invariantsDir(repoPath), 'bad.yaml')
    fs.mkdirSync(invariantsDir(repoPath), { recursive: true })
    fs.writeFileSync(malformedPath, 'not: a: valid: invariant\n')
    expect(() => readActiveInvariant(repoPath, 'bad')).toThrow(/Invalid invariant/)
  })
})

describe('invariant-store: drafts', () => {
  it('writes and reads back a draft', () => {
    const draft = makeDraft()
    writeDraft(repoPath, draft)
    expect(readDraft(repoPath, draft.id)?.id).toBe(draft.id)
  })

  it('lists drafts', () => {
    writeDraft(repoPath, makeDraft())
    writeDraft(repoPath, makeDraft())
    expect(listDrafts(repoPath)).toHaveLength(2)
  })

  it('deletes a draft', () => {
    const draft = makeDraft()
    writeDraft(repoPath, draft)
    expect(deleteDraft(repoPath, draft.id)).toBe(true)
    expect(readDraft(repoPath, draft.id)).toBeNull()
  })

  it('clears all drafts', () => {
    writeDraft(repoPath, makeDraft())
    writeDraft(repoPath, makeDraft())
    clearAllDrafts(repoPath)
    expect(listDrafts(repoPath)).toEqual([])
  })

  it('skips malformed draft files when listing', () => {
    writeDraft(repoPath, makeDraft())
    const dir = path.join(repoPath, '.truecourse', 'invariant-drafts')
    fs.writeFileSync(path.join(dir, 'malformed.json'), '{ not valid }')
    expect(listDrafts(repoPath)).toHaveLength(1)
  })
})

describe('invariant-store: rejected signatures', () => {
  it('appends and dedupes rejected entries', () => {
    appendRejected(repoPath, {
      type: 't',
      scope: 's',
      signature: 'abc',
      rejectedAt: '2026-04-25T10:00:00Z',
    })
    appendRejected(repoPath, {
      type: 't',
      scope: 's',
      signature: 'abc',
      rejectedAt: '2026-04-26T10:00:00Z',
    })
    appendRejected(repoPath, {
      type: 't',
      scope: 's2',
      signature: 'def',
      rejectedAt: '2026-04-25T10:00:00Z',
    })
    expect(readRejected(repoPath)).toHaveLength(2)
    expect(rejectedSignatureSet(repoPath)).toEqual(new Set(['abc', 'def']))
  })
})

describe('invariant-store: checkpoint', () => {
  it('round-trips a checkpoint', () => {
    const cp: InvariantCheckpoint = {
      truecourseVersion: '0.6.0',
      timestamp: '2026-04-25T10:00:00Z',
      fileHashes: { 'src/a.ts': 'abc123' },
      specSectionHashes: { 'FILE:SPEC.md#orders': 'def456' },
      coveredScopes: ['Order.status'],
    }
    writeCheckpoint(repoPath, cp)
    expect(readCheckpoint(repoPath)).toEqual(cp)
  })

  it('returns null when checkpoint missing', () => {
    expect(readCheckpoint(repoPath)).toBeNull()
  })

  it('returns null on malformed checkpoint', () => {
    fs.mkdirSync(path.join(repoPath, '.truecourse'), { recursive: true })
    fs.writeFileSync(checkpointPath(repoPath), '{"not": "valid"}')
    expect(readCheckpoint(repoPath)).toBeNull()
  })
})
