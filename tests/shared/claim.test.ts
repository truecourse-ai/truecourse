/**
 * A claim's identity is its document and the keys of the sentences it is read
 * from: order-free, stable while the sentences stand, new when they change.
 */
import { describe, expect, it } from 'vitest'
import { ClaimSchema, ClaimsFileSchema, claimId, claimIdDoc, claimsById, isClaimId, sentenceKey } from '@truecourse/shared'

describe('claimId', () => {
  const a = sentenceKey('Export my data is under Settings, Account.')
  const b = sentenceKey('It runs nightly.')

  it('names a claim by its doc and its sentence keys, whatever their order', () => {
    expect(claimId('docs/export.md', [a, b])).toBe(claimId('docs/export.md', [b, a]))
    expect(claimId('docs/export.md', [a])).not.toBe(claimId('docs/export.md', [a, b]))
    expect(claimId('docs/export.md', [a])).not.toBe(claimId('docs/other.md', [a]))
    expect(isClaimId(claimId('docs/export.md', [a]))).toBe(true)
    expect(isClaimId('conflict::x')).toBe(false)
  })

  it('keeps the doc readable in the id', () => {
    expect(claimId('docs/export.md', [a]).startsWith('claim::docs/export.md::')).toBe(true)
    expect(claimIdDoc(claimId('docs/export.md', [a]))).toBe('docs/export.md')
    expect(claimIdDoc('conflict::x')).toBeNull()
  })

  it('tells apart two claims read from the same sentences by their order', () => {
    expect(claimId('docs/export.md', [a], 1)).not.toBe(claimId('docs/export.md', [a]))
    expect(claimId('docs/export.md', [a], 0)).toBe(claimId('docs/export.md', [a]))
  })
})

describe('ClaimSchema', () => {
  const claim = {
    id: claimId('docs/export.md', [sentenceKey('x')]),
    doc: 'docs/export.md',
    sentences: [sentenceKey('x')],
    subject: 'Export my data',
    statement: 'Export my data is under Settings, Account.',
    areas: ['core/exports'],
    testable: true,
  }

  it('takes a testable claim and one with a reason it is not', () => {
    expect(ClaimSchema.safeParse(claim).success).toBe(true)
    expect(ClaimSchema.safeParse({ ...claim, testable: { reason: 'hedge' } }).success).toBe(true)
  })

  it('refuses a claim with no sentence, an unknown reason, or a bare false', () => {
    expect(ClaimSchema.safeParse({ ...claim, sentences: [] }).success).toBe(false)
    expect(ClaimSchema.safeParse({ ...claim, testable: { reason: 'nope' } }).success).toBe(false)
    expect(ClaimSchema.safeParse({ ...claim, testable: false }).success).toBe(false)
  })

  it('files claims under version 1', () => {
    expect(ClaimsFileSchema.safeParse({ version: 1, generatedAt: '2026-10-07T00:00:00.000Z', claims: [claim] }).success).toBe(true)
    expect(ClaimsFileSchema.safeParse({ version: 2, generatedAt: '', claims: [] }).success).toBe(false)
  })
})

describe('claimsById', () => {
  it('keeps the FIRST of a duplicated id, so a lookup is never ambiguous', () => {
    const first = { id: 'claim::d::x', statement: 'first' }
    const second = { id: 'claim::d::y', statement: 'second' }
    const dupe = { id: 'claim::d::x', statement: 'a later duplicate' }
    const byId = claimsById([first, second, dupe])
    expect([...byId.keys()]).toEqual([first.id, second.id])
    expect(byId.get(first.id)).toBe(first)
  })
})
