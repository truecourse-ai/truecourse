import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  acceptDraft,
  buildSlug,
  listActive,
  listPendingDrafts,
  rejectDraft,
  retireBySlug,
} from '../../packages/core/src/services/invariants/lifecycle'
import {
  rejectedSignatureSet,
  writeDraft,
} from '../../packages/core/src/lib/invariant-store'
import type { InvariantDraft } from '../../packages/shared/src/types/invariants'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-invariant-lifecycle-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function makeDraft(overrides: Partial<InvariantDraft> = {}): InvariantDraft {
  return {
    id: randomUUID(),
    type: 'rest-contract',
    pluginVersion: 1,
    scope: 'FILE:SPEC.md#post-users',
    declaration: {
      kind: 'status-code',
      claim: 'POST /users returns 201 on creation',
      obligationKey: 'POST /users status-201',
      sourceSection: 'FILE:SPEC.md#post-users',
      codeAnchor: { filePath: 'src/handler.ts' },
      enforcement: 'llm',
    },
    provenance: {
      source: 'discovered',
      inputs: ['spec', 'code'],
      timestamp: '2026-04-25T10:00:00Z',
    },
    rationale: 'spec section contains the claim',
    confidence: 0.9,
    ...overrides,
  }
}

describe('lifecycle: buildSlug', () => {
  it('builds slug from type + scope', () => {
    expect(buildSlug('state-machine', 'Order.status')).toBe('state-machine__order-status')
  })

  it('replaces non-alphanumeric chars with dashes', () => {
    expect(buildSlug('rest-contract', 'FILE:SPEC.md#post-users')).toBe(
      'rest-contract__file-spec-md-post-users',
    )
  })

  it('lowercases and trims', () => {
    expect(buildSlug('ordering', 'Order.CreatedAt')).toBe('ordering__order-createdat')
  })
})

describe('lifecycle: acceptDraft', () => {
  it('writes an active invariant and removes the draft', () => {
    const draft = makeDraft()
    writeDraft(repoPath, draft)
    const result = acceptDraft(repoPath, draft.id)
    expect(result.invariant.type).toBe('rest-contract')
    expect(result.slug).toMatch(/^rest-contract__/)
    expect(listPendingDrafts(repoPath)).toHaveLength(0)
    expect(listActive(repoPath)).toHaveLength(1)
  })

  it('throws when the draft does not exist', () => {
    expect(() => acceptDraft(repoPath, 'nonexistent')).toThrow(/not found/)
  })

  it('preserves the draft declaration verbatim', () => {
    const draft = makeDraft()
    writeDraft(repoPath, draft)
    const result = acceptDraft(repoPath, draft.id)
    expect(result.invariant.declaration).toEqual(draft.declaration)
  })

  it('disambiguates slug with -2/-3 suffix when (type, scope) collides', () => {
    // Two drafts with the same type + scope but different declarations —
    // legitimate for rest-contract (multiple claims per spec section).
    const a = makeDraft()
    const b = makeDraft()
    writeDraft(repoPath, a)
    writeDraft(repoPath, b)

    const r1 = acceptDraft(repoPath, a.id)
    const r2 = acceptDraft(repoPath, b.id)

    expect(r1.slug).toBe('rest-contract__file-spec-md-post-users')
    expect(r2.slug).toBe('rest-contract__file-spec-md-post-users-2')
    expect(listActive(repoPath)).toHaveLength(2)

    // A third on the same scope picks -3, not -2.
    const c = makeDraft()
    writeDraft(repoPath, c)
    const r3 = acceptDraft(repoPath, c.id)
    expect(r3.slug).toBe('rest-contract__file-spec-md-post-users-3')
    expect(listActive(repoPath)).toHaveLength(3)
  })
})

describe('lifecycle: rejectDraft', () => {
  it('persists the signature and removes the draft', () => {
    const draft = makeDraft()
    writeDraft(repoPath, draft)
    rejectDraft(repoPath, draft.id)
    expect(listPendingDrafts(repoPath)).toHaveLength(0)
    expect(rejectedSignatureSet(repoPath).size).toBe(1)
  })

  it('throws when the draft does not exist', () => {
    expect(() => rejectDraft(repoPath, 'nonexistent')).toThrow(/not found/)
  })
})

describe('lifecycle: retireBySlug', () => {
  it('returns true when an invariant was retired', () => {
    const draft = makeDraft()
    writeDraft(repoPath, draft)
    const result = acceptDraft(repoPath, draft.id)
    expect(retireBySlug(repoPath, result.slug)).toBe(true)
    expect(listActive(repoPath)).toHaveLength(0)
  })

  it('returns false when no such slug exists', () => {
    expect(retireBySlug(repoPath, 'never-existed')).toBe(false)
  })
})
