/**
 * The claims-persist merge: extraction's claims must land in the committable
 * claim corpus (union by identity), because flows and scenario milestones
 * resolve against it at load time — and a no-op merge must not touch the file
 * (an unchanged re-run stays byte-identical).
 */
import { describe, it, expect } from 'vitest'
import { mergeExtractedClaims } from '@truecourse/guard-generator'
import { claimContentHash, guardClaimKey, type GuardClaimsFile } from '@truecourse/shared'
import { crossCheckClaimRefs } from '@truecourse/guard-runner'

const NOW = '2026-08-28T00:00:00.000Z'

const handFile: GuardClaimsFile = {
  version: 1,
  generatedAt: '2026-08-01T00:00:00.000Z',
  claims: [
    {
      id: 'cart-holds-items',
      doc: 'docs/cart.mdx',
      anchor: 'cart',
      title: 'A cart holds items',
      claim: 'A cart holds the items a customer intends to purchase.',
      contentHash: 'sha256:hand',
    },
  ],
  untestable: [{ doc: 'docs/cart.mdx', anchor: 'cart', text: 'Carts are great.', reason: 'marketing' }],
}

const extractedCartLocale = {
  doc: 'docs/cart.mdx',
  outcome: {
    claims: [
      {
        claim: 'A cart created with a locale stores it on the Cart model.',
        driver: 'api' as const,
        sectionAnchor: 'cart/locale',
        reason: 'POST /store/carts with a locale, read it back',
        needs: [],
      },
    ],
  },
}

describe('mergeExtractedClaims', () => {
  it('appends extracted claims to an existing corpus, preserving every prior entry', () => {
    const { file, added } = mergeExtractedClaims(handFile, [extractedCartLocale], NOW)
    expect(added).toBe(1)
    expect(file.claims).toHaveLength(2)
    expect(file.claims[0]).toEqual(handFile.claims[0])
    expect(file.untestable).toEqual(handFile.untestable)
    expect(file.generatedAt).toBe(NOW)
    const minted = file.claims[1]
    // title IS the sentence — the identity a flow milestone's claimTitle resolves through
    expect(minted.title).toBe(extractedCartLocale.outcome.claims[0].claim)
    expect(minted.claim).toBe(minted.title)
    expect(minted.verifyVia).toBe('POST /store/carts with a locale, read it back')
    expect(minted.needs).toBeUndefined()
    expect(minted.contentHash).toBe(claimContentHash(minted))
  })

  it('adds nothing when the identity already exists, and does not restamp generatedAt', () => {
    const first = mergeExtractedClaims(handFile, [extractedCartLocale], NOW)
    const again = mergeExtractedClaims(first.file, [extractedCartLocale], '2026-08-29T00:00:00.000Z')
    expect(again.added).toBe(0)
    expect(again.file).toBe(first.file)
  })

  it('seeds an empty corpus when none exists', () => {
    const { file, added } = mergeExtractedClaims(null, [extractedCartLocale], NOW)
    expect(added).toBe(1)
    expect(file.version).toBe(1)
    expect(file.claims).toHaveLength(1)
  })

  it('numbers a minted id that collides with an existing one', () => {
    const colliding = {
      doc: 'docs/other.mdx',
      outcome: {
        claims: [
          {
            claim: 'A cart holds items',
            driver: 'api' as const,
            sectionAnchor: 'other',
            reason: 'observable',
            needs: [],
          },
        ],
      },
    }
    const { file } = mergeExtractedClaims(handFile, [colliding], NOW)
    const ids = file.claims.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[1]).toBe('a-cart-holds-items')
  })

  it('resolves a flow milestone that references a merged claim', () => {
    const { file } = mergeExtractedClaims(handFile, [extractedCartLocale], NOW)
    const flows = {
      version: 1 as const,
      generatedAt: NOW,
      flows: [
        {
          id: 'cart-locale',
          title: 'Cart locale',
          fingerprint: 'sha256:x',
          milestones: [
            {
              order: 1,
              doc: 'docs/cart.mdx',
              anchor: 'cart/locale',
              claimTitle: 'A cart created with a locale stores it on the Cart model.',
            },
          ],
        },
      ],
      noFlowClaims: [],
    }
    const errors = crossCheckClaimRefs({
      claims: file,
      flows: flows as never,
      scenarios: [],
    })
    expect(errors).toEqual([])
    // and the reference really is by the identity the merge minted
    expect(
      file.claims.some(
        (c) => guardClaimKey(c) === guardClaimKey({ doc: 'docs/cart.mdx', anchor: 'cart/locale', title: flows.flows[0].milestones[0].claimTitle }),
      ),
    ).toBe(true)
  })
})
