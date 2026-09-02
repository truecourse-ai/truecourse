/**
 * CLUSTERING — which places one session's reading serves several of, and the
 * pack that reading becomes (SPEC_GUARD_PLAN item 8).
 *
 * Two properties are under test and they pull against each other: a cluster
 * must be ALIKE enough that its members really do render the same modules, and
 * it must keep enough modules in COMMON that the pack it opens with is worth
 * sending. The tests below are the shapes a real app produces — a settings area
 * that shares a form shell, a screen that shares one button, a chain of places
 * each half-alike to the last.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WebPlaceContext } from '../../packages/interface-mapper/src/web-context'
import {
  MAX_CLUSTER_MEMBERS,
  MIN_SHARED,
  clusterPlaces,
  orderClustersLongestFirst,
  type PlaceCluster,
} from '../../packages/core/src/services/interface-author/cluster'
import { MAX_PACK_BYTES, clusterPack } from '../../packages/core/src/services/interface-author/pack'

/** A context pack carrying only what clustering reads: the rendered modules. */
function renders(...modules: string[]): WebPlaceContext {
  return {
    module: `${modules[0] ?? 'unknown'}`,
    renders: modules,
    closure: modules.length + 1,
    apiEffects: [],
    unjoined: [],
    rpcCalls: [],
  }
}

/** The eight modules a settings area's screens all render. */
const SHELL = ['a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'e.tsx', 'f.tsx', 'g.tsx', 'h.tsx']

describe('clustering places by what they render', () => {
  it('groups the places that render the same modules and leaves the rest alone', () => {
    const context = new Map<string, WebPlaceContext>([
      ['settings-profile', renders(...SHELL, 'profile.tsx')],
      ['home', renders('home.tsx', 'grid.tsx')],
      ['settings-billing', renders(...SHELL, 'billing.tsx')],
      ['settings-team', renders(...SHELL, 'team.tsx', 'invite.tsx')],
    ])
    const clusters = clusterPlaces({
      places: ['settings-profile', 'home', 'settings-billing', 'settings-team'],
      context,
    })

    expect(clusters.map((c) => c.places)).toEqual([
      ['settings-profile', 'settings-billing', 'settings-team'],
      ['home'],
    ])
    // The shared set is the INTERSECTION — never a module a member does not render.
    expect(clusters[0].shared).toEqual([...SHELL].sort())
    expect(clusters[0].id).toBe('cluster/settings-profile')
    // A cluster of one shares nothing with anybody, and says so.
    expect(clusters[1].shared).toEqual([])
  })

  it('is deterministic: the same places in the same order give the same clusters', () => {
    const context = new Map<string, WebPlaceContext>([
      ['one', renders(...SHELL)],
      ['two', renders(...SHELL, 'two.tsx')],
      ['three', renders(...SHELL, 'three.tsx')],
    ])
    const places = ['one', 'two', 'three']
    const first = clusterPlaces({ places, context })
    expect(clusterPlaces({ places, context })).toEqual(first)
  })

  it('keeps a place that only shares a design-system button out of the cluster', () => {
    // Four of the eight modules in common is half the intersection but a third
    // of the union — alike enough to look related, not alike enough to pack.
    const context = new Map<string, WebPlaceContext>([
      ['settings-profile', renders(...SHELL)],
      ['reports', renders('a.tsx', 'r1.tsx', 'r2.tsx', 'r3.tsx', 'r4.tsx', 'r5.tsx', 'r6.tsx', 'r7.tsx')],
    ])
    const clusters = clusterPlaces({ places: ['settings-profile', 'reports'], context })
    expect(clusters.map((c) => c.places)).toEqual([['settings-profile'], ['reports']])
  })

  it('never lets a chain of members dilute the cluster below the shared floor', () => {
    // `far` is alike enough to the SEED to pass the similarity test, but the
    // three-way intersection would be four modules — a pack too small to pay
    // for, so it opens its own cluster instead of shrinking this one.
    const context = new Map<string, WebPlaceContext>([
      ['seed', renders('a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'e.tsx', 'f.tsx')],
      ['near', renders('a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'e.tsx', 'f.tsx')],
      ['far', renders('a.tsx', 'b.tsx', 'c.tsx', 'd.tsx', 'x.tsx', 'y.tsx')],
    ])
    const clusters = clusterPlaces({ places: ['seed', 'near', 'far'], context })
    expect(clusters.map((c) => c.places)).toEqual([['seed', 'near'], ['far']])
    expect(clusters[0].shared).toHaveLength(6)
  })

  it('makes a singleton of a place with no context and of one that renders too little', () => {
    const context = new Map<string, WebPlaceContext>([
      ['small-a', renders('a.tsx', 'b.tsx')],
      ['small-b', renders('a.tsx', 'b.tsx')],
    ])
    const clusters = clusterPlaces({ places: ['unmapped', 'small-a', 'small-b'], context })
    // Identical renderers, but two modules is not a pack.
    expect(clusters.map((c) => c.places)).toEqual([['unmapped'], ['small-a'], ['small-b']])
  })

  it('takes the thresholds from the caller when a measurement wants other ones', () => {
    const context = new Map<string, WebPlaceContext>([
      ['a', renders('a.tsx', 'b.tsx')],
      ['b', renders('a.tsx', 'b.tsx', 'c.tsx')],
    ])
    const clusters = clusterPlaces({ places: ['a', 'b'], context, minShared: 2, minJaccard: 0.5 })
    expect(clusters.map((c) => c.places)).toEqual([['a', 'b']])
    expect(clusters[0].shared).toEqual(['a.tsx', 'b.tsx'])
  })
})

/**
 * THE SERIAL-CHAIN BOUND (01 step 2j). A cluster's members run one after
 * another, so the run cannot finish before its longest cluster does — at ~20
 * minutes a member, an eight-member group is a two-and-a-half hour critical
 * path that no amount of workers shortens. The greedy pass therefore stops
 * admitting members at {@link MAX_CLUSTER_MEMBERS}, and the peers it turns away
 * regroup under a later seed rather than being scattered into singletons.
 */
describe('a cluster is capped at the serial chain it can afford', () => {
  /** Eight places that all render the same eight modules plus one of their own. */
  const eight = new Map<string, WebPlaceContext>(
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((id) => [
      id,
      renders(...SHELL, `${id}.tsx`),
    ]),
  )
  const places = [...eight.keys()]

  it('splits an over-large group into whole clusters, each still worth a pack', () => {
    const clusters = clusterPlaces({ places, context: eight })

    // Every pair here is 0.8 alike, so without the cap this is one group of 8.
    expect(clusters.map((c) => c.places)).toEqual([
      ['p1', 'p2', 'p3'],
      ['p4', 'p5', 'p6'],
      ['p7', 'p8'],
    ])
    for (const cluster of clusters) {
      expect(cluster.places.length).toBeLessThanOrEqual(MAX_CLUSTER_MEMBERS)
      // A split cluster is still a cluster: it keeps the shared-prefix property.
      expect(cluster.shared.length).toBeGreaterThanOrEqual(MIN_SHARED)
    }
    // Seeded by the first unassigned place, so the ids read off the work list.
    expect(clusters.map((c) => c.id)).toEqual(['cluster/p1', 'cluster/p4', 'cluster/p7'])
    // Still a pure function of its input, cap and all.
    expect(clusterPlaces({ places, context: eight })).toEqual(clusters)
  })

  it('is a threshold like the others — a measurement may lift it', () => {
    const clusters = clusterPlaces({ places, context: eight, maxMembers: Number.POSITIVE_INFINITY })
    expect(clusters.map((c) => c.places)).toEqual([places])
    expect(clusters[0].shared).toEqual([...SHELL].sort())
  })
})

/**
 * THE HAND-OFF ORDER (same step). The pool starts serial groups in the order it
 * is handed them, so the order IS the schedule: starting the longest chain last
 * adds its whole length to the makespan for nothing.
 */
describe('ordering the clusters for the pool', () => {
  const cluster = (id: string, size: number): PlaceCluster => ({
    id,
    places: Array.from({ length: size }, (_, index) => `${id}-${index}`),
    shared: [],
  })

  it('puts the longest chain first and keeps equal-length clusters in work-list order', () => {
    const input = [cluster('a', 1), cluster('b', 3), cluster('c', 2), cluster('d', 3), cluster('e', 1)]
    const before = input.map((c) => c.id)

    expect(orderClustersLongestFirst(input).map((c) => c.id)).toEqual(['b', 'd', 'c', 'a', 'e'])
    // The caller keeps its own list — the schedule is a second view of it.
    expect(input.map((c) => c.id)).toEqual(before)
  })
})

describe('the cluster pack', () => {
  let repo: string

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cluster-pack-'))
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
    for (const name of ['shell', 'table', 'dialog', 'field', 'button']) {
      fs.writeFileSync(
        path.join(repo, 'src', `${name}.tsx`),
        `export function ${name}() {\n  return <button>${name}</button>\n}\n`,
      )
    }
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  const shared = ['src/button.tsx', 'src/dialog.tsx', 'src/field.tsx', 'src/shell.tsx', 'src/table.tsx']

  it('carries the shared modules whole, in `read_file`\'s own shape', () => {
    const pack = clusterPack(repo, { id: 'cluster/a', places: ['a', 'b'], shared })!
    expect(pack.modules).toEqual(shared)
    expect(pack.omitted).toEqual([])
    expect(pack.text).toContain('Do NOT `read_file` any of them again')
    // The same rendering the tool produces, so a module looks the same either way.
    expect(pack.text).toContain('src/shell.tsx (4 lines)')
    expect(pack.text).toContain('1\texport function shell() {')
    expect(pack.bytes).toBeLessThan(MAX_PACK_BYTES)
  })

  it('has nothing to say for a cluster of one', () => {
    expect(clusterPack(repo, { id: 'cluster/a', places: ['a'], shared: [] })).toBeUndefined()
  })

  it('skips a module that is not there rather than failing the cluster', () => {
    const pack = clusterPack(repo, {
      id: 'cluster/a',
      places: ['a', 'b'],
      shared: ['src/shell.tsx', 'src/gone.tsx', '../outside.tsx'],
    })!
    expect(pack.modules).toEqual(['src/shell.tsx'])
    expect(pack.omitted).toEqual([])
  })

  /**
   * A module is packed WHOLE or not at all — the pack tells the session not to
   * read these again, and half a file with that instruction on it is worse than
   * no file. What did not fit is named, so the session reads exactly those.
   */
  it('names what the byte budget left out, and packs no half a file', () => {
    const huge = Array.from({ length: 4_000 }, (_, line) => `  const value${line} = ${line}`)
    fs.writeFileSync(path.join(repo, 'src', 'huge.tsx'), huge.join('\n'))
    const pack = clusterPack(repo, {
      id: 'cluster/a',
      places: ['a', 'b'],
      shared: ['src/huge.tsx', 'src/shell.tsx'],
    })!
    expect(pack.modules).toEqual(['src/shell.tsx'])
    expect(pack.omitted).toEqual(['src/huge.tsx'])
    expect(pack.text).toContain('did not fit')
    expect(pack.text).toContain('  src/huge.tsx')
    expect(pack.bytes).toBeLessThan(MAX_PACK_BYTES)
  })
})
