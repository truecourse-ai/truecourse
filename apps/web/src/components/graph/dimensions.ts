/**
 * Single source of truth for default React Flow node dimensions across the
 * architecture-graph views. Dashboard Graph tab (`useGraph.ts`) and the
 * ADR Living Fragment renderer (`AdrGraphFragmentDiagram`) both read
 * from here so tweaks apply uniformly.
 *
 * Values match the server's `computeDagreLayout` defaults in
 * `apps/server/src/services/graph.service.ts` — changing them here keeps
 * the client layout metrics in sync with the positions the server picks.
 */
export const GRAPH_NODE_DIMENSIONS = {
  service: { width: 280, height: 120 },
  database: { width: 200, height: 80 },
  module: { width: 240, height: 100 },
} as const;
