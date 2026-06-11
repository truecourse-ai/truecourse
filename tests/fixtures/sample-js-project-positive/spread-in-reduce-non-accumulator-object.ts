// Positive: performance/deterministic/spread-in-reduce
//
// The O(n^2) anti-pattern is spreading the *accumulator* on every iteration
// (`return { ...acc, [k]: v }`). Here the accumulator is mutated in place and
// returned directly; the only spread is over a small, fixed-size local
// object, which is constant work per element. The rule must not flag spreads
// that do not copy the accumulator.

interface GraphNode {
  readonly id: string;
  readonly weight: number;
}

interface NodeState {
  readonly weight: number;
  readonly visited: boolean;
}

export function indexNodes(nodes: readonly GraphNode[]): Record<string, NodeState> {
  return nodes.reduce<Record<string, NodeState>>((acc, node) => {
    const base = { weight: node.weight, visited: false };
    acc[node.id] = { ...base, visited: true };
    return acc;
  }, {});
}
