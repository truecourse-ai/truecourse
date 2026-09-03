/**
 * CLUSTERS — the places whose sessions would read the SAME modules, grouped so
 * they can be told once instead of each.
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
  /** What the AST pass knows about each place; the `renders` is the input. */
  context: ReadonlyMap<string, WebPlaceContext>
  /** Overridable for measurement; the defaults are {@link MIN_JACCARD}/{@link MIN_SHARED}/{@link MAX_CLUSTER_MEMBERS}. */
  minJaccard?: number
  minShared?: number
  maxMembers?: number
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
 * How many places one cluster may hold — the bound on the SERIAL chain.
 *
 * A cluster runs one member after another so peers see each other's folded
 * work, and the run's wall clock is bound by the longest single chain: on the
 * measured documenso run the makespan at 20 workers equalled the longest
 * cluster exactly, and 40 workers bought nothing. At ~20 min/member an 8-member
 * chain is a ~2.5 hour critical path, so over-large groups are SPLIT (the
 * greedy pass stops admitting members at the cap; the leftover peers seed their
 * own clusters by the same similarity rules, so every split cluster keeps the
 * shared-prefix property).
 *
 * The tradeoff is real: clustering exists so peers of one cluster see each
 * other's folded work — which is what killed the pilot's duplicate-id
 * collisions — and a smaller cap means more cross-cluster pairs that cannot see
 * each other. Phase C's reconciliation is the backstop for exactly those pairs.
 * Raising this buys agreement and costs wall clock, linearly.
 */
export const MAX_CLUSTER_MEMBERS = 3

/**
 * Group the places. Seeded greedily in work-list order: the first unassigned
 * place opens a cluster, and every later unassigned place joins it when it is
 * alike enough (Jaccard against the SEED — the pairwise fact) AND leaves the
 * cluster with enough in common (against the running intersection — the pack's
 * fact), until the cluster is FULL ({@link MAX_CLUSTER_MEMBERS} — the serial
 * chain bound; the members it turns away regroup under a later seed).
 * Everything else ends up in a cluster of its own, which is the correct
 * answer for a place nobody shares a screen's worth of components with.
 */
export function clusterPlaces(input: ClusterPlacesInput): PlaceCluster[] {
  const minJaccard = input.minJaccard ?? MIN_JACCARD
  const minShared = input.minShared ?? MIN_SHARED
  const maxMembers = input.maxMembers ?? MAX_CLUSTER_MEMBERS
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
        if (places.length >= maxMembers) break
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

/**
 * LPT ORDER — longest chain first. A cluster's members run serially, so the run
 * cannot finish before its longest cluster does; starting that chain LAST adds
 * its whole length to the makespan for free. Classic longest-processing-time
 * scheduling, with total member count as the length proxy (session duration is
 * provider latency nobody knows up front). STABLE on ties — clusters of equal
 * size keep their work-list order — so the hand-off stays deterministic.
 *
 * Members inside each cluster keep their order untouched: the pool runs a
 * serial group in item order, and a member's briefing builds on its
 * predecessors' folded work.
 */
export function orderClustersLongestFirst(clusters: readonly PlaceCluster[]): PlaceCluster[] {
  return clusters
    .map((cluster, index) => ({ cluster, index }))
    .sort((a, b) => b.cluster.places.length - a.cluster.places.length || a.index - b.index)
    .map((entry) => entry.cluster)
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
