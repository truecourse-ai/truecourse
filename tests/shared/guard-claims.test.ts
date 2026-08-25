import { describe, it, expect } from 'vitest'
import {
  EMPTY_GUARD_CLAIMS,
  GuardClaimsFileSchema,
  claimContentHash,
  claimIdentityKey,
  claimsById,
  claimsByIdentity,
  dismissedClaimKey,
  guardClaimKey,
  isClaimContentCurrent,
  type GuardClaim,
} from '@truecourse/shared'

const base = {
  id: 'analyze-creates-the-store',
  doc: 'docs/analyze/overview.mdx',
  anchor: 'overview',
  title: 'the first analyze creates .truecourse/',
  claim: 'The first `truecourse analyze` in a repository creates the `.truecourse/` directory.',
}
const claim = (over: Partial<GuardClaim> = {}): GuardClaim => ({
  ...base,
  contentHash: claimContentHash(base),
  ...over,
})

describe('GuardClaimsFileSchema', () => {
  it('round-trips a full claim and a full untestable entry', () => {
    const file = {
      version: 1,
      generatedAt: '2026-08-07T03:24:38.348Z',
      claims: [{ ...claim(), verifyVia: 'file: `.truecourse/` exists after the run' }],
      untestable: [
        {
          doc: 'docs/analyze/overview.mdx',
          anchor: 'overview',
          text: 'View results visually with `truecourse dashboard`.',
          reason: 'dashboard-UI surface, out of CLI scope.',
        },
      ],
    }
    const parsed = GuardClaimsFileSchema.parse(file)
    expect(parsed).toEqual(file)
    expect(GuardClaimsFileSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(file)
  })

  it('defaults the two lists, so a minimal file still parses', () => {
    const parsed = GuardClaimsFileSchema.parse({ version: 1, generatedAt: 'x' })
    expect(parsed.claims).toEqual([])
    expect(parsed.untestable).toEqual([])
    expect(
      GuardClaimsFileSchema.parse({
        version: 1,
        generatedAt: 'x',
        claims: [{ ...base, contentHash: 'sha256:abc' }],
      }).claims[0],
    ).toEqual({ ...base, contentHash: 'sha256:abc' })
  })

  // `needs` came BACK as a structured field with plan 04 step 15: the
  // extraction session reports what testing a claim takes beyond an empty
  // sandbox, and those needs ride into flow synthesis. The retired STRING form
  // (and `notes`, which never came back) must still fail to load rather than
  // silently drop half of what a stale corpus says.
  it('accepts structured `needs`, and still rejects the retired string form and `notes`', () => {
    const parse = (over: Record<string, unknown>) =>
      GuardClaimsFileSchema.safeParse({
        version: 1,
        generatedAt: 'x',
        claims: [{ ...base, contentHash: 'sha256:abc', ...over }],
      })

    expect(parse({ needs: [] }).success).toBe(true)
    const structured = parse({ needs: [{ kind: 'credential', name: 'github-token', detail: 'a repo token' }] })
    expect(structured.success).toBe(true)
    expect(structured.data?.claims[0].needs).toEqual([
      { kind: 'credential', name: 'github-token', detail: 'a repo token' },
    ])

    for (const stale of [
      { needs: ['supplied-project'] },
      { notes: 'authoring rationale' },
      { needs: [{ kind: 'invented', name: 'x' }] },
      { needs: [{ kind: 'fixture', name: 'x', extra: 1 }] },
    ]) {
      const result = parse(stale)
      expect(result.success, Object.keys(stale)[0]).toBe(false)
    }
  })

  // Needs are ADVISORY grounding — refining them must never re-author the
  // claim's flows, so they stay outside the content hash and the identity key.
  it('keeps `needs` out of the content hash and the identity key', () => {
    const withNeeds: GuardClaim = { ...claim(), needs: [{ kind: 'state', name: 'an-existing-project' }] }
    expect(claimContentHash(withNeeds)).toBe(claimContentHash(claim()))
    expect(guardClaimKey(withNeeds)).toBe(guardClaimKey(claim()))
    expect(isClaimContentCurrent(withNeeds)).toBe(true)
  })

  it('rejects an unknown field and a missing identity component', () => {
    expect(GuardClaimsFileSchema.safeParse({ version: 1, generatedAt: 'x', extra: 1 }).success).toBe(false)
    expect(
      GuardClaimsFileSchema.safeParse({
        version: 1,
        generatedAt: 'x',
        claims: [{ ...base, title: '', contentHash: 'sha256:abc' }],
      }).success,
    ).toBe(false)
  })

  it('accepts the empty seed', () => {
    expect(GuardClaimsFileSchema.parse(EMPTY_GUARD_CLAIMS)).toEqual(EMPTY_GUARD_CLAIMS)
  })
})

describe('claim identity', () => {
  it('is doc + anchor + title, and IS the dismissal key', () => {
    expect(guardClaimKey(claim())).toBe(claimIdentityKey(base.doc, base.anchor, base.title))
    expect(claimIdentityKey(base.doc, base.anchor, base.title)).toBe(
      dismissedClaimKey(base.doc, base.anchor, base.title),
    )
  })

  it('separates its parts so no two triples can collide', () => {
    expect(claimIdentityKey('a', 'b/c', 'd')).not.toBe(claimIdentityKey('a', 'b', 'c/d'))
  })
})

describe('claimContentHash', () => {
  it('is stable across re-wrapping and trailing whitespace', () => {
    const wrapped = claimContentHash({ ...base, claim: base.claim.replace(' in a repository', '\n   in a repository') })
    expect(wrapped).toBe(claimContentHash(base))
    expect(claimContentHash({ ...base, title: `  ${base.title}  ` })).toBe(claimContentHash(base))
  })

  it('rolls when the claim sentence, title, anchor or doc changes', () => {
    const at = claimContentHash(base)
    expect(claimContentHash({ ...base, claim: `${base.claim} Always.` })).not.toBe(at)
    expect(claimContentHash({ ...base, title: 'a different title' })).not.toBe(at)
    expect(claimContentHash({ ...base, anchor: 'overview-2' })).not.toBe(at)
    expect(claimContentHash({ ...base, doc: 'docs/other.mdx' })).not.toBe(at)
  })

  it('does NOT change for the claim id or its verify-via', () => {
    // Only the invalidation material is hashed: re-slugging an id must never
    // re-author the claim's flows.
    const at = claimContentHash(base)
    expect(claimContentHash({ ...base, id: 'renamed' } as typeof base & { id: string })).toBe(at)
  })

  it('is prefixed with its algorithm and detected as current or stale', () => {
    expect(claimContentHash(base)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(isClaimContentCurrent(claim())).toBe(true)
    expect(isClaimContentCurrent(claim({ claim: 'something else entirely' }))).toBe(false)
  })
})

describe('claim lookups', () => {
  const a = claim()
  const b = claim({ id: 'second', title: 'a second claim' })
  it('indexes by id and by identity', () => {
    expect([...claimsById([a, b]).keys()]).toEqual([a.id, b.id])
    expect(claimsByIdentity([a, b]).get(guardClaimKey(b))).toBe(b)
  })

  it('keeps the FIRST of a duplicated key, so a lookup is never ambiguous', () => {
    const dupe = claim({ claim: 'a different sentence' })
    expect(claimsById([a, dupe]).get(a.id)).toBe(a)
    expect(claimsByIdentity([a, dupe]).get(guardClaimKey(a))).toBe(a)
  })
})
