/**
 * AFFINITY PARTITION: a set of items too large for one session cut into parts
 * that keep the items naming the same rare things together. The fact
 * comparison splits an oversize area, an oversize subject and an oversize list
 * of subject names with it, and forms its subject families with its clustering
 * step.
 *
 * Deterministic, in five steps:
 *
 * 1. Each item's tokens: the content words of its text (lowercased, stop words
 *    dropped, three characters or more, not a bare number) and the code-shaped
 *    tokens {@link extractClaimTokens} finds.
 * 2. Tokens are idf-weighted over the items being split, `log2((n+1)/df)`. A
 *    token in more than `dfCap` items (by default {@link PAIR_GEN_DF_CAP}, as
 *    in collision pairing) is vocabulary and links nothing.
 * 3. Two items from different passages that share a linking token get an edge
 *    weighted by the summed weight of what they share. Two items of one
 *    passage are never compared against each other, so nothing links them.
 * 4. Edges are taken heaviest first, ties by item order, and an edge merges
 *    its two items' clusters only while the merged cluster's summed item
 *    weight fits the bound: Kruskal with a size cap. Every item weighs one
 *    unless the caller weighs it (a subject weighs its facts).
 * 5. Clusters are packed into parts first-fit, heaviest first (ties by their
 *    first item), each part at most the bound; items with no edge then fill the
 *    remaining room in item order, first-fit. An item heavier than the bound is
 *    a part of its own.
 *
 * An edge whose two items land in different parts is a CUT PAIR: the parts and
 * the cut pairs say how much a split separated.
 */

import { extractClaimTokens, PAIR_GEN_DF_CAP } from './collision-pairing.js';
import { STOPWORDS } from './pointer-verifier.js';

/** Content words shorter than this link nothing (`api`, `ats` still do). */
const MIN_WORD_CHARS = 3;

export interface AffinityOptions<T> {
  /** The most summed item weight one cluster, and one part, holds. */
  maxSize: number;
  /** The text an item is linked by. */
  text: (item: T) => string;
  /** The passage an item comes from; two items of one passage are never linked. */
  passage: (item: T) => string;
  /** What an item counts for against `maxSize`; one when absent. */
  weight?: (item: T) => number;
  /** A token in more items than this links nothing; {@link PAIR_GEN_DF_CAP} when absent. */
  dfCap?: number;
}

export interface AffinityPartition<T> {
  /** The parts, in packing order; each holds its items in their input order. */
  parts: T[][];
  /** Linked pairs whose two items landed in different parts. */
  cutPairs: number;
}

/** The tokens one item is linked by (step 1). */
export function affinityTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= MIN_WORD_CHARS && !STOPWORDS.has(word) && !/^\d+$/.test(word)) tokens.add(word);
  }
  for (const token of extractClaimTokens(text)) tokens.add(token);
  return tokens;
}

/** Weights are rounded before they are compared, so equal sums tie exactly. */
const roundWeight = (w: number): number => Math.round(w * 1e9) / 1e9;

interface AffinityGraph {
  /** Every linked pair `i < j`, heaviest first. */
  edges: Array<{ i: number; j: number }>;
  /** Each item's cluster, as the cluster's first item. */
  clusterOf: number[];
  /** Whether an item has any edge. */
  linked: boolean[];
  /** Each item's weight. */
  weights: number[];
}

/** Steps 1 to 4: the edges between the items, and the clusters the capped merge leaves. */
function affinityGraph<T>(items: readonly T[], opts: AffinityOptions<T>): AffinityGraph {
  const { maxSize } = opts;
  if (!Number.isFinite(maxSize) || maxSize <= 0) throw new Error(`affinity: maxSize ${maxSize} is not a positive number`);
  const n = items.length;
  const dfCap = opts.dfCap ?? PAIR_GEN_DF_CAP;
  const weights = items.map((item) => opts.weight?.(item) ?? 1);
  const passages = items.map(opts.passage);
  const carriers = new Map<string, number[]>();
  items.forEach((item, i) => {
    for (const token of affinityTokens(opts.text(item))) {
      const list = carriers.get(token);
      if (list) list.push(i);
      else carriers.set(token, [i]);
    }
  });

  // An edge per linked pair `i < j`, keyed `i * n + j`.
  const sums = new Map<number, number>();
  for (const list of carriers.values()) {
    if (list.length < 2 || list.length > dfCap) continue;
    const w = Math.log2((n + 1) / list.length);
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a]!;
        const j = list[b]!;
        if (passages[i] === passages[j]) continue;
        const key = i * n + j;
        sums.set(key, (sums.get(key) ?? 0) + w);
      }
    }
  }
  const edges = [...sums].map(([key, w]) => ({ i: Math.floor(key / n), j: key % n, w: roundWeight(w) }));
  edges.sort((x, y) => y.w - x.w || x.i - y.i || x.j - y.j);

  // Kruskal with a weight cap. A root is always its cluster's first item.
  const parent = Array.from({ length: n }, (_, i) => i);
  const load = [...weights];
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const linked = new Array<boolean>(n).fill(false);
  for (const { i, j } of edges) {
    linked[i] = true;
    linked[j] = true;
    const ri = find(i);
    const rj = find(j);
    if (ri === rj || load[ri]! + load[rj]! > maxSize) continue;
    const [keep, join] = ri < rj ? [ri, rj] : [rj, ri];
    parent[join] = keep;
    load[keep] = load[keep]! + load[join]!;
  }
  return { edges, clusterOf: Array.from({ length: n }, (_, i) => find(i)), linked, weights };
}

/**
 * Steps 1 to 4 alone: every item in exactly one cluster, the items its rare
 * tokens link it to as far as the bound allows (an unlinked item is a cluster
 * of one). Clusters come in the order of their first item, each holding its
 * items in input order.
 */
export function clusterByAffinity<T>(items: readonly T[], opts: AffinityOptions<T>): T[][] {
  const { clusterOf } = affinityGraph(items, opts);
  const clusters = new Map<number, T[]>();
  items.forEach((item, i) => {
    const cluster = clusters.get(clusterOf[i]!);
    if (cluster) cluster.push(item);
    else clusters.set(clusterOf[i]!, [item]);
  });
  return [...clusters.values()];
}

/**
 * Split `items` into parts of at most `maxSize` summed weight, keeping linked
 * items together where they fit. An input whose whole weight fits is one part,
 * as given.
 */
export function partitionByAffinity<T>(items: readonly T[], opts: AffinityOptions<T>): AffinityPartition<T> {
  const total = items.reduce((sum, item) => sum + (opts.weight?.(item) ?? 1), 0);
  if (total <= opts.maxSize) return { parts: items.length === 0 ? [] : [[...items]], cutPairs: 0 };
  const { edges, clusterOf, linked, weights } = affinityGraph(items, opts);

  // Step 5: clusters first-fit, heaviest first; then the unlinked items in order.
  const clusters = new Map<number, number[]>();
  const loose: number[] = [];
  items.forEach((_, i) => {
    if (!linked[i]) {
      loose.push(i);
      return;
    }
    const members = clusters.get(clusterOf[i]!);
    if (members) members.push(i);
    else clusters.set(clusterOf[i]!, [i]);
  });
  const weightOf = (members: readonly number[]): number => members.reduce((sum, i) => sum + weights[i]!, 0);
  const parts: Array<{ members: number[]; load: number }> = [];
  const place = (members: readonly number[]): void => {
    const w = weightOf(members);
    const part = parts.find((p) => p.load + w <= opts.maxSize);
    if (part) {
      part.members.push(...members);
      part.load += w;
    } else parts.push({ members: [...members], load: w });
  };
  [...clusters.values()].sort((x, y) => weightOf(y) - weightOf(x) || x[0]! - y[0]!).forEach(place);
  for (const i of loose) place([i]);

  const partOf = new Array<number>(items.length);
  parts.forEach((part, p) => {
    part.members.sort((a, b) => a - b);
    for (const i of part.members) partOf[i] = p;
  });
  const cutPairs = edges.filter(({ i, j }) => partOf[i] !== partOf[j]).length;
  return { parts: parts.map((part) => part.members.map((i) => items[i]!)), cutPairs };
}
