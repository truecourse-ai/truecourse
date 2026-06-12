// Spreading a fixed-size value (`nodeState`) while mutating the accumulator in
// place is linear — not the O(n^2) spread-the-accumulator anti-pattern — and
// must not be flagged.

interface NodeState {
  selected: boolean
  expanded: boolean
}

interface TreeNode {
  id: string
}

export function buildState(
  nodes: readonly TreeNode[],
  base: Record<string, NodeState>,
): Record<string, NodeState> {
  return nodes.reduce(
    (acc, node) => {
      const nodeState = base[node.id] ?? { selected: false, expanded: true }
      acc[node.id] = { ...nodeState, expanded: false }
      return acc
    },
    {} as Record<string, NodeState>,
  )
}
