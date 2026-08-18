/**
 * CLUSTERS — the places whose sessions would read the SAME modules, grouped so
 * they can be told once instead of each (SPEC_GUARD_PLAN item 8).
 *
 * A web app's screens are not independent readers. Measured over one app's 85
 * places: 44 of them fall into 16 groups that render mostly the same component
 * files — a settings area whose eight screens all render the same form shell,
 * table and dialog primitives. Authored one session per place, those modules
 * are read, re-read and re-sent 13.9M tokens' worth over a run.
 *
 * What a cluster is FOR is therefore two things, and both need the same
 * grouping:
 *
 *  - the shared PACK ({@link clusterPack}): the intersection's contents handed
 *    over once as the prompt prefix every member opens with, so the modules are
 *    already in context and the read turns disappear;
 *  - the shared PROMPT PREFIX: identical bytes across the cluster, which is the
 *    only thing a provider's prompt cache can actually reuse between sessions.
 *
 * And one more, which is why the SCHEDULING (`author.ts`) consumes clusters
 * rather than places: a cluster runs SERIALLY, so each member is briefed with
 * its peers' work already folded in. Every duplicate-id collision the pilot run
 * produced was between two places of one cluster — the same dialog authored
 * twice under two names, by two sessions that could not see each other. Peers
 * of different clusters still cannot, and Phase C's reconciliation is what
 * settles those.
 *
 * Pure: place ids and their context packs in, groups out. No filesystem, no
 * LLM, and the same input always gives the same clusters in the same order.
 */

import type { WebPlaceContext } from '@truecourse/interface-mapper'

/** One group of places that render the same modules — possibly a group of one. */
export interface PlaceCluster {
  /** Stable name, from the place that seeded it — a transcript can be read by it. */
  id: string
  /** Member place ids, work-list order, the seed first. */
  places: string[]
  /**
   * The modules EVERY member renders, sorted. This is what the pack carries, so
   * it is the intersection and never the union: a module one member does not
   * render is a module that member would be told not to read and never see.
   * Empty for a cluster of one, which shares nothing with anybody.
   */
  shared: string[]
}

export interface ClusterPlacesInput {
  /** The places to group, in work-list order — the order clusters come back in. */
  places: readonly string[]
  /** What the AST pass knows about each place (item 105); the `renders` is the input. */
  context: ReadonlyMap<string, WebPlaceContext>
  /** Overridable for measurement; the defaults are {@link MIN_JACCARD}/{@link MIN_SHARED}. */
  minJaccard?: number
  minShared?: number
}

/**
 * How alike two places' rendered modules must be. Half the union is the level
 * the measured groups actually sit at: below it a cluster starts joining a
 * screen that merely imports the same button, whose intersection is a design
 * system and whose pack helps nobody.
 */
export const MIN_JACCARD = 0.5

/**
 * How many modules a cluster must still share once a member joins. It is the
 * PACK's floor, not a similarity threshold: fewer than five modules in common
 * is a prefix too small to pay for the turn that reads it, and it is checked
 * against the running intersection so a cluster cannot dilute itself member by
 * member into a group that shares nothing.
 */
export const MIN_SHARED = 5

/**
 * Group the places. Seeded greedily in work-list order: the first unassigned
 * place opens a cluster, and every later unassigned place joins it when it is
 * alike enough (Jaccard against the SEED — the pairwise fact) AND leaves the
 * cluster with enough in common (against the running intersection — the pack's
 * fact). Everything else ends up in a cluster of its own, which is the correct
 * answer for a place nobody shares a screen's worth of components with.
 */
export function clusterPlaces(input: ClusterPlacesInput): PlaceCluster[] {
  const minJaccard = input.minJaccard ?? MIN_JACCARD
  const minShared = input.minShared ?? MIN_SHARED
  const rendered = new Map<string, Set<string>>()
  for (const place of input.places) {
    rendered.set(place, new Set(input.context.get(place)?.renders ?? []))
  }

  const clusters: PlaceCluster[] = []
  const taken = new Set<string>()
  for (const seed of input.places) {
    if (taken.has(seed)) continue
    taken.add(seed)
    const seedModules = rendered.get(seed)!
    const places = [seed]
    let shared = new Set(seedModules)

    // A place that renders fewer modules than the floor cannot reach it with
    // anybody, so it never opens a cluster of more than itself.
    if (seedModules.size >= minShared) {
      for (const candidate of input.places) {
        if (taken.has(candidate)) continue
        const modules = rendered.get(candidate)!
        if (jaccard(seedModules, modules) < minJaccard) continue
        const next = intersect(shared, modules)
        if (next.size < minShared) continue
        taken.add(candidate)
        places.push(candidate)
        shared = next
      }
    }
    clusters.push({
      id: `cluster/${seed}`,
      places,
      shared: places.length > 1 ? [...shared].sort() : [],
    })
  }
  return clusters
}

/** |A ∩ B| / |A ∪ B|; two empty sets are alike in nothing. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const shared = intersect(a, b).size
  return shared / (a.size + b.size - shared)
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const both = new Set<string>()
  for (const value of a) if (b.has(value)) both.add(value)
  return both
}
