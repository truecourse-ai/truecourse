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
import { clusterPlaces } from '../../packages/interface-author/src/cluster'
import { MAX_PACK_BYTES, clusterPack } from '../../packages/interface-author/src/pack'

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
