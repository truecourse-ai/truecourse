/**
 * useSemanticZoom — React hook that drives semantic zoom transitions.
 *
 * Listens to viewport changes, debounces zoom level transitions, and
 * returns the correct set of nodes/edges/zoomLevel for the current zoom.
 *
 * Dagre runs per zoom level with correct container sizes, so parent nodes
 * grow/shrink to fit their children without overlapping.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Node, Edge, Viewport } from '@xyflow/react';
import type { SemanticZoomLevel } from '@/types/graph';
import type { AllLevelGraphResponse } from '@/lib/api';
import {
  getZoomLevel,
  getVisibleNodes,
  aggregateEdges,
  computeLayoutForZoom,
  type ZoomLayout,
} from '@/lib/semantic-zoom';

interface UseSemanticZoomOptions {
  data: AllLevelGraphResponse | null;
  enabled: boolean;
}

interface UseSemanticZoomResult {
  nodes: Node[];
  edges: Edge[];
  zoomLevel: SemanticZoomLevel;
  onViewportChange: (viewport: Viewport) => void;
}

export function useSemanticZoom({ data, enabled }: UseSemanticZoomOptions): UseSemanticZoomResult {
  const [zoomLevel, setZoomLevel] = useState<SemanticZoomLevel>('services');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track current zoom to debounce transitions
  const currentZoomRef = useRef(0.5);

  // Cache layouts per zoom level (invalidated when data changes)
  const layoutCache = useRef<Map<SemanticZoomLevel, ZoomLayout>>(new Map());

  // Invalidate cache when data changes
  useEffect(() => {
    layoutCache.current.clear();
  }, [data]);

  // Compute nodes/edges for a given level
  const computeForLevel = useCallback(
    (level: SemanticZoomLevel) => {
      if (!data) return { nodes: [], edges: [] };

      // Get or compute layout for this zoom level
      let layout = layoutCache.current.get(level);
      if (!layout) {
        layout = computeLayoutForZoom(data, level);
        layoutCache.current.set(level, layout);
      }

      const visibleNodes = getVisibleNodes(data, level, layout);
      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      const visibleEdges = aggregateEdges(data, level, visibleIds);

      return { nodes: visibleNodes, edges: visibleEdges };
    },
    [data],
  );

  // Recompute when level or data changes
  useEffect(() => {
    if (!enabled || !data) return;
    const result = computeForLevel(zoomLevel);
    setNodes(result.nodes);
    setEdges(result.edges);
  }, [enabled, data, zoomLevel, computeForLevel]);

  const onViewportChange = useCallback(
    (viewport: Viewport) => {
      if (!enabled || !data) return;

      currentZoomRef.current = viewport.zoom;
      const newLevel = getZoomLevel(viewport.zoom);

      if (newLevel === zoomLevel) return;

      // Debounce to prevent flickering during rapid zoom
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Re-check after debounce in case zoom changed again
        const finalLevel = getZoomLevel(currentZoomRef.current);
        if (finalLevel !== zoomLevel) {
          setZoomLevel(finalLevel);
        }
      }, 150);
    },
    [enabled, data, zoomLevel],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return { nodes, edges, zoomLevel, onViewportChange };
}
