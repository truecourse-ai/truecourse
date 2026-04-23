/**
 * Dagre-backed auto-layout for architecture graphs. Thin shared primitive
 * used by the main Graph tab (for bulk re-layout of top-level service
 * groups) and by the ADR Living Fragment renderer (for laying out the
 * decision-time subgraph). Callers build the React Flow node/edge data
 * shapes themselves — this function only runs dagre and stamps positions
 * onto the returned node copies.
 */
import dagre from 'dagre';
import { Position, type Node, type Edge } from '@xyflow/react';

export type GraphLayoutOptions = {
  /** 'TB' top→bottom (default, matches the main graph), 'LR' left→right. */
  rankdir?: 'TB' | 'LR';
  ranksep?: number;
  nodesep?: number;
  marginx?: number;
  marginy?: number;
  /** Fallback size used when a node has no style/measured dimensions.
   *  Main graph nodes usually carry style.width/style.height; ADR snapshot
   *  nodes don't, so they fall back to these. */
  defaultNodeWidth?: number;
  defaultNodeHeight?: number;
};

/**
 * Run dagre over `nodes` + `edges` and return a new node array with
 * `position.x` / `position.y` set to the computed center-offset.
 * Source/target handle positions are derived from `rankdir`.
 */
export function layoutNodesWithDagre(
  nodes: Node[],
  edges: Edge[],
  opts: GraphLayoutOptions = {},
): Node[] {
  if (nodes.length === 0) return nodes;

  const rankdir = opts.rankdir ?? 'TB';
  const ranksep = opts.ranksep ?? 120;
  const nodesep = opts.nodesep ?? 60;
  const marginx = opts.marginx ?? 40;
  const marginy = opts.marginy ?? 40;
  const fallbackW = opts.defaultNodeWidth ?? 220;
  const fallbackH = opts.defaultNodeHeight ?? 100;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, ranksep, nodesep, marginx, marginy });
  g.setDefaultEdgeLabel(() => ({}));

  const sizeOf = (node: Node) => {
    const style = (node as Record<string, unknown>).style as
      | { width?: number; height?: number }
      | undefined;
    const w = style?.width ?? node.measured?.width ?? fallbackW;
    const h = style?.height ?? node.measured?.height ?? fallbackH;
    return { w, h };
  };

  for (const node of nodes) {
    const { w, h } = sizeOf(node);
    g.setNode(node.id, { width: w, height: h });
  }
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.source}::${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const sourcePosition = rankdir === 'LR' ? Position.Right : Position.Bottom;
  const targetPosition = rankdir === 'LR' ? Position.Left : Position.Top;

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    const { w, h } = sizeOf(node);
    return {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      sourcePosition,
      targetPosition,
    };
  });
}
