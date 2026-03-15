'use client';

import { useState, useEffect, useCallback } from 'react';
import * as api from '@/lib/api';
import type { GraphNode, GraphEdge, ServiceNodeData, DepthLevel } from '@/types/graph';
import type { Node, Edge } from '@xyflow/react';

export function useGraph(repoId: string, branch?: string, level: DepthLevel = 'services') {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    if (!repoId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getGraph(repoId, { branch, level });

      if (level === 'modules' || level === 'methods' || level === 'layers') {
        // Layer-level view: mix of serviceGroupNode, layerNode, and databaseNode types
        const graphNodes: Node[] = data.nodes.map((node) => {
          if (node.type === 'databaseNode') {
            return {
              id: node.id,
              type: 'database' as const,
              position: node.position,
              data: {
                label: node.data.label,
                databaseType: node.data.databaseType || node.data.serviceType,
                tableCount: node.data.tableCount ?? node.data.fileCount ?? 0,
                connectedServices: node.data.connectedServices || [],
                framework: node.data.framework,
              },
            };
          }

          if (node.type === 'methodNode') {
            return {
              id: node.id,
              type: 'method' as const,
              position: node.position,
              parentId: node.parentId,
              extent: node.extent as 'parent' | undefined,
              data: node.data,
            };
          }

          if (node.type === 'moduleNode') {
            return {
              id: node.id,
              type: 'module' as const,
              position: node.position,
              parentId: node.parentId,
              extent: node.extent as 'parent' | undefined,
              style: node.style,
              data: {
                label: node.data.label,
                moduleKind: node.data.moduleKind || node.data.serviceType || 'standalone',
                methodCount: node.data.methodCount ?? node.data.fileCount ?? 0,
                propertyCount: node.data.propertyCount,
                importCount: node.data.importCount,
                exportCount: node.data.exportCount,
                superClass: node.data.superClass,
                layerColor: node.data.layerColor || '#6b7280',
                isDead: node.data.isDead || false,
                isContainer: node.data.isContainer || false,
                violations: node.data.violations,
              },
            };
          }

          if (node.type === 'layerNode') {
            return {
              id: node.id,
              type: 'layer' as const,
              position: node.position,
              parentId: node.parentId,
              extent: node.extent as 'parent' | undefined,
              style: node.style,
              data: {
                label: node.data.label,
                layer: node.data.label,
                fileCount: node.data.fileCount || 0,
                layerColor: node.data.layerColor || '#6b7280',
                fileNames: node.data.fileNames || [],
                isContainer: node.data.isContainer || false,
                violations: node.data.violations || [],
              },
            };
          }

          // serviceGroupNode
          return {
            id: node.id,
            type: 'serviceGroup' as const,
            position: node.position,
            style: node.style,
            data: {
              label: node.data.label,
              description: node.data.description,
              serviceType: node.data.serviceType || 'unknown',
              framework: node.data.framework,
              fileCount: node.data.fileCount || 0,
              layers: node.data.layers || [],
              violations: node.data.violations || [],
            },
          };
        });

        const graphEdges: Edge[] = data.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.data.dependencyType === 'database' ? 'database' : 'intraLayer',
          data: {
            label: '',
            dependencyCount: edge.data.dependencyCount || 0,
            hasHttpCalls: edge.data.dependencyType === 'http',
            isViolation: edge.data.isViolation || false,
            violationReason: edge.data.violationReason,
          },
        }));

        setNodes(graphNodes);
        setEdges(graphEdges);
      } else {
        // Service-level view (existing behavior)
        const graphNodes: Node[] = data.nodes.map((node) => {
          if (node.type === 'databaseNode') {
            return {
              id: node.id,
              type: 'database' as const,
              position: node.position,
              data: {
                label: node.data.label,
                databaseType: node.data.databaseType || node.data.serviceType,
                tableCount: node.data.tableCount ?? node.data.fileCount ?? 0,
                connectedServices: node.data.connectedServices || [],
                framework: node.data.framework,
              },
            };
          }

          return {
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
          };
        });

        const graphEdges: Edge[] = data.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.data.dependencyType === 'database' ? 'database' : 'dependency',
          data: {
            label: edge.data.dependencyType === 'http'
              ? `${edge.data.dependencyCount || 0} HTTP call${(edge.data.dependencyCount || 0) !== 1 ? 's' : ''}`
              : edge.data.dependencyType === 'database'
                ? ''
                : `${edge.data.dependencyCount || 0} import${(edge.data.dependencyCount || 0) !== 1 ? 's' : ''}`,
            dependencyCount: edge.data.dependencyCount || 0,
            hasHttpCalls: edge.data.dependencyType === 'http',
          },
        }));

        setNodes(graphNodes);
        setEdges(graphEdges);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, branch, level]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  return { nodes, edges, isLoading, error, refetch: fetchGraph, setNodes, setEdges };
}
