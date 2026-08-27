/**
 * COLLISION PAIRING — the deterministic candidate net behind the overlap
 * sessions. What is under test:
 *
 * - claim-token extraction: the four code-shaped identifier families, and the
 *   noise they must NOT emit;
 * - pair derivation: cross-doc only, rarity-gated (a token everywhere pairs
 *   nothing), ranked by summed idf weight;
 * - the canonical-heading fold (`Authentication` ↔ `Auth`) that subsumed the
 *   retired doc-level widened net;
 * - single-area assignment (item 119's multi-tag fix) and connected-component
 *   clustering;
 * - the identity fingerprint: stable under weight shifts, changed by pair
 *   membership.
 */

import { describe, it, expect } from 'vitest'
import {
  assignPairArea,
  clusterPairs,
  deriveCollisionPairs,
  extractClaimTokens,
  pairsFingerprint,
  type CollisionPair,
  type DocCandidate,
} from '../../packages/spec-consolidator/src/index.js'

const doc = (path: string, content: string): DocCandidate => ({
  path,
  absPath: `/abs/${path}`,
  content,
  kind: 'prd',
  preview: content.split('\n').slice(0, 5).join('\n'),
  lastTouched: '2026-01-01T00:00:00Z',
  contentHash: `hash-${path}`,
  size: content.length,
})

describe('extractClaimTokens', () => {
  it('extracts route segments, UPPER_SNAKE, ALL-CAPS, camelCase, snake_case, and hyphenated header names', () => {
    const tokens = extractClaimTokens(
      'POST /envelope/{id}/distribute returns LIMIT_EXCEEDED for a VIEWER; set positionX or signing_order, honor Retry-After.',
    )
    expect(tokens).toContain('envelope')
    expect(tokens).toContain('distribute')
    expect(tokens).toContain('limit_exceeded')
    expect(tokens).toContain('viewer')
    expect(tokens).toContain('positionx')
    expect(tokens).toContain('signing_order')
    expect(tokens).toContain('retry-after')
  })

  it('drops short tokens, bare numbers, and placeholder path segments', () => {
    const tokens = extractClaimTokens('GET /v2/{envelopeId}/x wait 60 seconds')
    expect(tokens).not.toContain('v2')
    expect(tokens).not.toContain('x')
    expect(tokens).not.toContain('60')
    expect(tokens).not.toContain('{envelopeid}')
  })

  it('does not extract plain prose words', () => {
    expect(extractClaimTokens('The document expires after some time.')).toEqual(new Set())
  })
})

describe('deriveCollisionPairs', () => {
  it('pairs two sections in DIFFERENT docs on a shared rare claim token — the distribute shape', () => {
    const docs = [
      doc(
        'docs/documents.md',
        '# Documents\n\n## Sending\n\nCall `POST /envelope/distribute` with the id in the body.\n\n## Other\n\nplain prose here\n',
      ),
      doc(
        'docs/first-call.md',
        '# First call\n\n## Send it\n\ncurl -X POST /envelope/env_123/distribute\n\n## More\n\nplain prose too\n',
      ),
    ]
    const pairs = deriveCollisionPairs(docs)
    const hit = pairs.find(
      (p) =>
        [p.a.doc, p.b.doc].sort().join() === 'docs/documents.md,docs/first-call.md' &&
        p.keys.includes('distribute'),
    )
    expect(hit).toBeDefined()
    expect([hit!.a.heading, hit!.b.heading].sort()).toEqual(['Send it', 'Sending'])
  })

  it('never pairs sections of the SAME doc', () => {
    const docs = [
      doc('docs/one.md', '# One\n\n## A\n\n`POST /thing/create`\n\n## B\n\n`POST /thing/create` again\n'),
      doc('docs/two.md', '# Two\n\nno identifiers at all\n'),
    ]
    expect(deriveCollisionPairs(docs)).toEqual([])
  })

  it('pairs sections whose headings fold to the same canonical concern (Authentication ↔ Auth)', () => {
    const docs = [
      doc('docs/auth.md', '# Auth\n\nTokens are minted here.\n\n## Unrelated\n\nplain prose\n'),
      doc('docs/notes.md', '# Notes\n\nsomething else entirely\n\n## Authentication\n\nTokens come from the auth service.\n'),
    ]
    const pairs = deriveCollisionPairs(docs)
    const hit = pairs.find((p) => p.keys.includes('heading:auth'))
    expect(hit).toBeDefined()
    expect([hit!.a.heading, hit!.b.heading].sort()).toEqual(['Auth', 'Authentication'])
  })

  it('a key present in EVERY section falls below the score floor and pairs nothing', () => {
    const everywhere = (name: string): string =>
      `# ${name}\n\n\`sharedToken\` here\n\n## ${name} first\n\n\`sharedToken\` again\n\n## ${name} second\n\n\`sharedToken\` once more\n`
    expect(deriveCollisionPairs([doc('a.md', everywhere('Alpha')), doc('b.md', everywhere('Beta'))])).toEqual([])
  })

  it('still pairs a TWO-doc corpus on shared identifiers, even though their df equals the section count', () => {
    const docs = [
      doc('a.md', 'Set `sessionTtl` and `tokenScope` here.'),
      doc('b.md', 'Set `sessionTtl` and `tokenScope` there.'),
    ]
    const pairs = deriveCollisionPairs(docs)
    expect(pairs).toHaveLength(1)
    expect(pairs[0].keys).toEqual(['sessionttl', 'tokenscope'])
  })

  it('ranks a pair sharing MORE rare keys above a pair sharing one', () => {
    const docs = [
      doc('a.md', '# A\n\n## Strong\n\n`alphaKey` and `betaKey`\n\n## Weak\n\n`gammaKey`\n\n## Pad\n\nnothing\n'),
      doc('b.md', '# B\n\n## StrongToo\n\n`alphaKey` and `betaKey`\n\n## WeakToo\n\n`gammaKey`\n\n## PadToo\n\nnothing\n'),
    ]
    const pairs = deriveCollisionPairs(docs)
    const strong = pairs.findIndex((p) => p.keys.includes('alphakey'))
    const weak = pairs.findIndex((p) => p.keys.includes('gammakey'))
    expect(strong).toBeGreaterThanOrEqual(0)
    expect(weak).toBeGreaterThanOrEqual(0)
    expect(strong).toBeLessThan(weak)
  })

  it('greedy max-coverage: a unique-signal pair survives its doc pair\'s higher-scoring walls, a redundant pair does not', () => {
    // Two "wall" sections share a fat token set; a modest section pair shares
    // one token nothing else covers (the distribute shape); a third pair
    // re-evidences only covered tokens.
    const wall = '`alphaKey` `betaKey` `gammaKey` `deltaKey` `epsilonKey`'
    const docs = [
      doc(
        'a.md',
        `# A\n\n## Wall One\n\n${wall}\n\n## Wall Two\n\n${wall}\n\n## Route\n\n\`POST /envelope/uniqueRoute\`\n\n## Pad\n\nnothing here\n`,
      ),
      doc(
        'b.md',
        `# B\n\n## Wall Three\n\n${wall}\n\n## Send\n\ncurl \`/envelope/uniqueRoute\`\n\n## PadB\n\nnothing here\n`,
      ),
    ]
    const pairs = deriveCollisionPairs(docs)
    const kept = pairs.map((p) => [p.a.heading, p.b.heading].sort().join(' <-> '))
    // One wall pair covers the fat token set; the second wall pair adds nothing.
    expect(kept.filter((k) => k.includes('Wall'))).toHaveLength(1)
    // The unique-route pair survives beneath it.
    expect(kept).toContainEqual('Route <-> Send')
  })

  it('is fence-aware: a `#` comment inside a code fence is not a section', () => {
    const docs = [
      doc('a.md', '# A\n\n```bash\n# install deps\nnpm i somePackage\n```\n'),
      doc('b.md', '# B\n\n```bash\n# install deps\nnpm i somePackage\n```\n'),
    ]
    for (const p of deriveCollisionPairs(docs)) {
      expect(p.a.heading).not.toBe('install deps')
      expect(p.b.heading).not.toBe('install deps')
    }
  })
})

describe('assignPairArea', () => {
  const pair: CollisionPair = {
    a: { doc: 'a.md', heading: null },
    b: { doc: 'b.md', heading: null },
    keys: ['k'],
    score: 2,
  }

  it('picks the lexicographically-first SHARED area', () => {
    const areas = new Map([
      ['a.md', ['core/billing', 'core/auth']],
      ['b.md', ['core/auth', 'core/billing']],
    ])
    expect(assignPairArea(pair, areas)).toBe('core/auth')
  })

  it('falls back to the first area of the union when the docs share none', () => {
    const areas = new Map([
      ['a.md', ['core/zeta']],
      ['b.md', ['core/notes']],
    ])
    expect(assignPairArea(pair, areas)).toBe('core/notes')
  })

  it('returns null when neither doc has an area', () => {
    expect(assignPairArea(pair, new Map())).toBeNull()
  })
})

describe('clusterPairs', () => {
  const p = (a: string, b: string, score: number): CollisionPair => ({
    a: { doc: a, heading: null },
    b: { doc: b, heading: null },
    keys: ['k'],
    score,
  })

  it('splits disjoint doc components and keeps the hottest component first', () => {
    const clusters = clusterPairs([p('a.md', 'b.md', 5), p('c.md', 'd.md', 4), p('b.md', 'e.md', 3)])
    expect(clusters).toHaveLength(2)
    // a-b-e connect through b; their component leads (its first pair ranks highest).
    expect(clusters[0].map((x) => [x.a.doc, x.b.doc])).toEqual([
      ['a.md', 'b.md'],
      ['b.md', 'e.md'],
    ])
    expect(clusters[1].map((x) => [x.a.doc, x.b.doc])).toEqual([['c.md', 'd.md']])
  })
})

describe('pairsFingerprint', () => {
  const base: CollisionPair = {
    a: { doc: 'a.md', heading: 'X' },
    b: { doc: 'b.md', heading: 'Y' },
    keys: ['k1'],
    score: 3,
  }

  it('is stable under score and key changes (weights shift when unrelated docs change)', () => {
    expect(pairsFingerprint([base])).toBe(pairsFingerprint([{ ...base, score: 9, keys: ['k1', 'k2'] }]))
  })

  it('changes when pair membership changes', () => {
    const other: CollisionPair = { ...base, b: { doc: 'c.md', heading: 'Z' } }
    expect(pairsFingerprint([base])).not.toBe(pairsFingerprint([base, other]))
  })
})
