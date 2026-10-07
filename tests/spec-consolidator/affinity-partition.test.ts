/**
 * `partitionByAffinity`: a set of items over a size bound cut into parts that
 * keep items sharing rare words together. What is under test: the same items
 * always give the same parts; no part is ever over the bound; items that share
 * a rare token stay together when they fit; a token in too many items links
 * nothing; two items of one sentence are never linked; the linked pairs a cut
 * separates are counted; an input under the bound is one part. With item
 * weights the bound holds the summed weight, and the clustering step alone
 * keeps every item once, linked items together up to the bound.
 */

import { describe, expect, it } from 'vitest'
import { PAIR_GEN_DF_CAP, clusterByAffinity, partitionByAffinity } from '../../packages/spec-consolidator/src/index.js'

interface Item {
  id: number
  text: string
  origin?: string
}

const options = (maxSize: number) => ({
  maxSize,
  text: (item: Item) => item.text,
  origin: (item: Item) => item.origin ?? `p${item.id}`,
})

const items = (texts: readonly string[]): Item[] => texts.map((text, id) => ({ id, text }))
const ids = (parts: readonly Item[][]): number[][] => parts.map((part) => part.map((item) => item.id))

/** Groups of items sharing a rare word each, interleaved so item order does not group them. */
function interleaved(groups: number, size: number): Item[] {
  const out: Item[] = []
  for (let k = 0; k < size; k++) {
    for (let g = 0; g < groups; g++) out.push({ id: out.length, text: `The checker${g} for unique${out.length}` })
  }
  return out
}

describe('partitionByAffinity', () => {
  it('returns an input under the bound as one part, in its order', () => {
    const input = items(['ATS checker scores', 'Export my data', 'ENCRYPTION_SECRET is required'])
    expect(partitionByAffinity(input, options(3))).toEqual({ parts: [input], cutPairs: 0 })
    expect(partitionByAffinity([], options(3))).toEqual({ parts: [], cutPairs: 0 })
  })

  it('keeps the items that share a rare word together when they fit', () => {
    const input = interleaved(4, 5)
    const { parts, cutPairs } = partitionByAffinity(input, options(10))
    expect(cutPairs).toBe(0)
    for (const part of parts) {
      const groups = new Set(part.map((item) => /checker(\d)/.exec(item.text)![1]))
      // A part holds whole groups: every group's five items, or none of them.
      for (const g of groups) expect(part.filter((item) => item.text.includes(`checker${g} `))).toHaveLength(5)
    }
    expect(parts.map((part) => part.length)).toEqual([10, 10])
  })

  it('never puts more items in a part than the bound, and places each item once', () => {
    const input = Array.from({ length: 53 }, (_, i) => ({
      id: i,
      text: `token${i % 7} shared${i % 3} alpha${i % 11} beta${(i * 7) % 13} RATE_LIMIT_${i % 5}`,
    }))
    for (const bound of [4, 7, 10, 25]) {
      const { parts } = partitionByAffinity(input, options(bound))
      expect(parts.every((part) => part.length <= bound)).toBe(true)
      expect(parts.flat().map((item) => item.id).sort((a, b) => a - b)).toEqual(input.map((item) => item.id))
    }
  })

  it('gives the same parts for the same items, every time', () => {
    const input = interleaved(5, 7)
    const first = partitionByAffinity(input, options(12))
    expect(partitionByAffinity(input, options(12))).toEqual(first)
    expect(partitionByAffinity(input.map((item) => ({ ...item })), options(12))).toEqual(first)
  })

  it('counts the linked pairs a cut separates', () => {
    // Six items share one word: four fit together, the other two go apart.
    const input = items(Array.from({ length: 6 }, (_, i) => `zebra crossing ${i}`))
    const { parts, cutPairs } = partitionByAffinity(input, options(4))
    expect(ids(parts)).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ])
    // "zebra" and "crossing" link every pair; 4 x 2 of them span the two parts.
    expect(cutPairs).toBe(8)
  })

  it('links by code-shaped tokens as well as words', () => {
    const input = items(['ENCRYPTION_SECRET must be set', 'Filler one', 'Filler two', 'Set ENCRYPTION_SECRET before boot'])
    const { parts } = partitionByAffinity(input, options(2))
    expect(ids(parts)).toContainEqual([0, 3])
  })

  it('links nothing by a word in more items than the vocabulary cap', () => {
    const common = Array.from({ length: PAIR_GEN_DF_CAP + 1 }, (_, i) => `resume field ${i}`)
    const { parts, cutPairs } = partitionByAffinity(items(common), options(5))
    expect(cutPairs).toBe(0)
    // Nothing links, so the items fill the parts in their order.
    expect(ids(parts)[0]).toEqual([0, 1, 2, 3, 4])
  })

  it('never links two items of one origin', () => {
    const input: Item[] = [
      { id: 0, text: 'webhook retries', origin: 'a' },
      { id: 1, text: 'filler', origin: 'b' },
      { id: 2, text: 'webhook retries', origin: 'a' },
    ]
    const { parts, cutPairs } = partitionByAffinity(input, options(1))
    expect(ids(parts)).toEqual([[0], [1], [2]])
    expect(cutPairs).toBe(0)
  })
})

describe('partitionByAffinity with item weights', () => {
  interface Weighted {
    id: number
    text: string
    weight: number
  }
  const weighted = (maxSize: number, dfCap?: number) => ({
    maxSize,
    text: (item: Weighted) => item.text,
    origin: (item: Weighted) => `p${item.id}`,
    weight: (item: Weighted) => item.weight,
    ...(dfCap !== undefined ? { dfCap } : {}),
  })
  const of = (specs: ReadonlyArray<[string, number]>): Weighted[] => specs.map(([text, weight], id) => ({ id, text, weight }))
  const load = (part: readonly Weighted[]): number => part.reduce((n, item) => n + item.weight, 0)

  it('is one part while the summed weight fits, whatever the item count', () => {
    const input = of([['alpha', 2], ['beta', 3], ['gamma', 5]])
    expect(partitionByAffinity(input, weighted(10)).parts).toEqual([input])
  })

  it('holds every part to the bound by summed weight, and keeps linked items together while they fit', () => {
    const input = of([
      ['download button', 4],
      ['webhooks', 3],
      ['download dialog', 4],
      ['themes', 2],
      ['api keys', 6],
    ])
    const { parts, cutPairs } = partitionByAffinity(input, weighted(10))
    expect(parts.every((part) => load(part) <= 10)).toBe(true)
    expect(parts.map((part) => part.map((item) => item.id))).toContainEqual(expect.arrayContaining([0, 2]))
    expect(cutPairs).toBe(0)
  })

  it('stops a merge the weight would carry over the bound, and puts an item heavier than the bound in a part of its own', () => {
    const input = of([['download button', 6], ['download dialog', 6], ['huge', 30]])
    const { parts, cutPairs } = partitionByAffinity(input, weighted(10))
    // The two downloads link but cannot share a part; the unlinked item comes after them.
    expect(parts.map((part) => part.map((item) => item.id))).toEqual([[0], [1], [2]])
    expect(cutPairs).toBe(1)
  })

  it('links nothing by a token in more items than the cap it is given', () => {
    const input = of([['shared word', 1], ['shared term', 1], ['shared thing', 1]])
    expect(clusterByAffinity(input, weighted(10, 2)).map((c) => c.map((item) => item.id))).toEqual([[0], [1], [2]])
    expect(clusterByAffinity(input, weighted(10, 3)).map((c) => c.map((item) => item.id))).toEqual([[0, 1, 2]])
  })
})

describe('clusterByAffinity', () => {
  it('places every item in one cluster, in order of their first item, linked items together up to the bound', () => {
    const input = items(['Download PDF button', 'Themes', 'Download button', 'Download dialog', 'API keys'])
    expect(clusterByAffinity(input, options(10)).map((c) => c.map((item) => item.id))).toEqual([[0, 2, 3], [1], [4]])
    expect(clusterByAffinity(input, options(2)).map((c) => c.map((item) => item.id))).toEqual([[0, 2], [1], [3], [4]])
  })
})
