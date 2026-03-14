'use client';

import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { GraphNode, GraphEdge, ServiceNodeData } from '@/types/graph';

export function useGraph(repoId: string, branch?: string) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getGraph(repoId, branch);

      const graphNodes: GraphNode[] = data.nodes.map((node) => ({
        id: node.id,
        type: 'service' as const,
        position: node.position,
        data: {
          label: node.data.label,
          description: node.data.description,
          serviceInfo: {
            type: node.data.serviceType || 'unknown',
            framework: node.data.framework || null,
            fileCount: node.data.fileCount || 0,
            layers: (node.data.layers || []).map((l) => ({
              layer: l,
              confidence: 1,
              evidence: [],
            })),
            rootPath: node.data.rootPath || '',
          },
          insightCount: 0,
          hasHighSeverity: false,
        } as ServiceNodeData,
      }));

      const graphEdges: GraphEdge[] = data.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'dependency' as const,
        data: {
          label: edge.data.dependencyType === 'http'
            ? `${edge.data.dependencyCount || 0} HTTP call${(edge.data.dependencyCount || 0) !== 1 ? 's' : ''}`
            : `${edge.data.dependencyCount || 0} import${(edge.data.dependencyCount || 0) !== 1 ? 's' : ''}`,
          dependencyCount: edge.data.dependencyCount || 0,
          hasHttpCalls: edge.data.dependencyType === 'http',
        },
      }));

      setNodes(graphNodes);
      setEdges(graphEdges);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, branch]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  return { nodes, edges, isLoading, error, refetch: fetchGraph, setNodes, setEdges };
}
