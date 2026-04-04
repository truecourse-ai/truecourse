/**
 * useSemanticZoom — React hook that drives semantic zoom transitions.
 *
 * Listens to viewport changes, debounces zoom level transitions, and
 * returns the correct set of nodes/edges/zoomLevel for the current zoom.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Node, Edge, Viewport } from '@xyflow/react';
import type { SemanticZoomLevel } from '@/types/graph';
import type { AllLevelGraphResponse } from '@/lib/api';
import {
  getZoomLevel,
  getVisibleNodes,
  aggregateEdges,
  computeLayoutForLevel,
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

  // Cache layout results per zoom level
  const layoutCache = useRef<Map<SemanticZoomLevel, { nodes: Node[]; edges: Edge[] }>>(new Map());

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track current zoom to debounce transitions
  const currentZoomRef = useRef(0.5);

  const computeForLevel = useCallback(
    (level: SemanticZoomLevel) => {
      if (!data) return { nodes: [], edges: [] };

      const cached = layoutCache.current.get(level);
      if (cached) return cached;

      const visibleNodes = getVisibleNodes(data, level);
      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      const visibleEdges = aggregateEdges(data, level, visibleIds);
      const layoutNodes = computeLayoutForLevel(visibleNodes, visibleEdges);

      const result = { nodes: layoutNodes, edges: visibleEdges };
      layoutCache.current.set(level, result);
      return result;
    },
    [data],
  );

  // Invalidate cache when data changes
  useEffect(() => {
    layoutCache.current.clear();
  }, [data]);

  // Compute initial level
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
