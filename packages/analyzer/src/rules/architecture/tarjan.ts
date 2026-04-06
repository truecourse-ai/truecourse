// ---------------------------------------------------------------------------
// Tarjan's Strongly Connected Components (SCC) Algorithm
// ---------------------------------------------------------------------------
// Finds ALL cycles in a directed graph — including transitive cycles (A→B→C→A)
// — and groups overlapping cycles into components.
// O(V+E) time complexity.
// ---------------------------------------------------------------------------

export interface EdgeMetadata {
  isDynamic: boolean
  isTypeOnly: boolean
}

export interface CycleInfo {
  /** Cycle chain, e.g. ['A', 'B', 'C', 'A'] — last element repeats the first */
  chain: string[]
  /** All edges in the cycle are static imports */
  isStatic: boolean
  /** At least one edge in the cycle is a dynamic import() */
  isDynamic: boolean
  /** All edges in the cycle are type-only imports */
  isTypeOnly: boolean
}

export interface CycleResult {
  /** All strongly connected components with 2+ nodes (cycles) */
  components: string[][]
  /** Individual cycle chains for reporting */
  cycles: CycleInfo[]
}

/**
 * Find all cycles in a directed graph using Tarjan's SCC algorithm.
 *
 * @param adjacency - Map from node → set of successor nodes
 * @param edgeMetadata - Optional metadata per edge, keyed as "source::target"
 * @returns Strongly connected components and individual cycle chains
 */
export function findCycles(
  adjacency: Map<string, Set<string>>,
  edgeMetadata?: Map<string, EdgeMetadata>,
): CycleResult {
  const components: string[][] = []

  // Tarjan's algorithm state
  let index = 0
  const nodeIndex = new Map<string, number>()
  const nodeLowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []

  function strongConnect(v: string) {
    nodeIndex.set(v, index)
    nodeLowlink.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)

    const successors = adjacency.get(v)
    if (successors) {
      for (const w of successors) {
        if (!nodeIndex.has(w)) {
          // w has not yet been visited — recurse
          strongConnect(w)
          nodeLowlink.set(v, Math.min(nodeLowlink.get(v)!, nodeLowlink.get(w)!))
        } else if (onStack.has(w)) {
          // w is on the stack → part of the current SCC
          nodeLowlink.set(v, Math.min(nodeLowlink.get(v)!, nodeIndex.get(w)!))
        }
      }
    }

    // If v is a root node, pop the SCC
    if (nodeLowlink.get(v) === nodeIndex.get(v)) {
      const component: string[] = []
      let w: string
      do {
        w = stack.pop()!
        onStack.delete(w)
        component.push(w)
      } while (w !== v)

      // Only keep components with 2+ nodes (actual cycles)
      if (component.length >= 2) {
        components.push(component)
      }
    }
  }

  // Visit all nodes (handles disconnected subgraphs)
  for (const node of adjacency.keys()) {
    if (!nodeIndex.has(node)) {
      strongConnect(node)
    }
  }

  // Extract individual cycles from each SCC
  const cycles = extractCyclesFromComponents(components, adjacency, edgeMetadata)

  return { components, cycles }
}

/**
 * Extract reportable cycle chains from strongly connected components.
 *
 * For small SCCs (2-3 nodes), enumerate all simple cycles via DFS.
 * For larger SCCs, report representative cycles — one per node as starting point,
 * following shortest paths to avoid combinatorial explosion.
 */
function extractCyclesFromComponents(
  components: string[][],
  adjacency: Map<string, Set<string>>,
  edgeMetadata?: Map<string, EdgeMetadata>,
): CycleInfo[] {
  const allCycles: CycleInfo[] = []

  for (const component of components) {
    const componentSet = new Set(component)

    if (component.length <= 5) {
      // For small components, enumerate all simple cycles via DFS
      const simpleCycles = findSimpleCycles(component, componentSet, adjacency)
      for (const chain of simpleCycles) {
        allCycles.push(classifyChain(chain, edgeMetadata))
      }
    } else {
      // For large components, find one representative cycle per node
      const seen = new Set<string>()
      for (const start of component) {
        if (seen.has(start)) continue
        const chain = findShortestCycle(start, componentSet, adjacency)
        if (chain) {
          for (const node of chain) seen.add(node)
          allCycles.push(classifyChain(chain, edgeMetadata))
        }
      }
    }
  }

  return allCycles
}

/**
 * Enumerate all simple cycles within a small SCC via DFS.
 * Returns cycles as chains where the last element equals the first.
 */
function findSimpleCycles(
  component: string[],
  componentSet: Set<string>,
  adjacency: Map<string, Set<string>>,
): string[][] {
  const cycles: string[][] = []
  const seen = new Set<string>()

  // Use the smallest node (lexicographically) to avoid duplicate cycles
  // reported from different starting nodes
  const sorted = [...component].sort()

  for (const start of sorted) {
    const path: string[] = [start]
    const visited = new Set<string>([start])

    function dfs(current: string) {
      const successors = adjacency.get(current)
      if (!successors) return

      for (const next of successors) {
        if (!componentSet.has(next)) continue

        if (next === start && path.length >= 2) {
          // Found a cycle back to start
          const chain = [...path, start]
          // Only report if the starting node is the minimum in the cycle
          // to deduplicate (A→B→A and B→A→B are the same cycle)
          const minNode = path.reduce((a, b) => (a < b ? a : b))
          if (minNode === start) {
            cycles.push(chain)
          }
          continue
        }

        // Don't revisit nodes already on the path, and don't visit
        // nodes lexicographically before start (avoids duplication)
        if (!visited.has(next) && !seen.has(next)) {
          visited.add(next)
          path.push(next)
          dfs(next)
          path.pop()
          visited.delete(next)
        }
      }
    }

    dfs(start)
    seen.add(start)
  }

  return cycles
}

/**
 * Find the shortest cycle containing `start` within the SCC, using BFS.
 */
function findShortestCycle(
  start: string,
  componentSet: Set<string>,
  adjacency: Map<string, Set<string>>,
): string[] | null {
  // BFS from start, looking for a path back to start
  const queue: Array<{ node: string; path: string[] }> = []
  const visited = new Set<string>()

  const successors = adjacency.get(start)
  if (!successors) return null

  for (const next of successors) {
    if (!componentSet.has(next)) continue
    if (next === start) return [start, start] // self-loop (shouldn't happen with 2+ SCC)
    queue.push({ node: next, path: [start, next] })
    visited.add(next)
  }

  while (queue.length > 0) {
    const { node, path } = queue.shift()!
    const nexts = adjacency.get(node)
    if (!nexts) continue

    for (const next of nexts) {
      if (!componentSet.has(next)) continue
      if (next === start) {
        return [...path, start]
      }
      if (!visited.has(next)) {
        visited.add(next)
        queue.push({ node: next, path: [...path, next] })
      }
    }
  }

  return null
}

/**
 * Classify a cycle chain based on edge metadata.
 */
function classifyChain(
  chain: string[],
  edgeMetadata?: Map<string, EdgeMetadata>,
): CycleInfo {
  let allTypeOnly = true
  let anyDynamic = false

  if (edgeMetadata) {
    for (let i = 0; i < chain.length - 1; i++) {
      const key = `${chain[i]}::${chain[i + 1]}`
      const meta = edgeMetadata.get(key)
      if (meta) {
        if (!meta.isTypeOnly) allTypeOnly = false
        if (meta.isDynamic) anyDynamic = true
      } else {
        // No metadata — treat as static non-type import
        allTypeOnly = false
      }
    }
  } else {
    // No metadata at all — treat as static
    allTypeOnly = false
  }

  return {
    chain,
    isStatic: !anyDynamic && !allTypeOnly,
    isDynamic: anyDynamic,
    isTypeOnly: allTypeOnly,
  }
}
