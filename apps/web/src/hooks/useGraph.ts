
import { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '@/lib/api';
import type { DepthLevel } from '@/types/graph';
import type { Node, Edge } from '@xyflow/react';
import {
  buildDatabaseNodeData,
  buildServiceNodeData,
} from '@/components/graph/node-builders';

export type GraphScopeOption = { id: string; name: string };
export type GraphModuleOption = { id: string; name: string; serviceId: string; serviceName: string };
export type GraphScopes = { services: GraphScopeOption[]; modules: GraphModuleOption[] };

/** Sentinel for "user explicitly chose to see everything at this level" — distinct from null (unset). */
export const SCOPE_ALL = 'all';

type RawGraphNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  parentId?: string;
  extent?: string;
  style?: { width?: number; height?: number } & Record<string, unknown>;
  data: Record<string, unknown> & { label?: string };
};

/**
 * After scope filtering, kept containers (serviceGroup / layer / module)
 * still carry sizes laid out for their full set of children. Walk the tree
 * bottom-up and shrink each container to tightly fit its remaining children.
 *
 * Padding values mirror the server's layout constants in
 * `apps/server/src/services/graph.service.ts` (SVC_PAD_*, LAYER_PAD_*,
 * MOD_PAD_*, MODULE_NODE_HEIGHT) so the tightened containers look identical
 * in header/body proportions to the server-rendered ones.
 */
type ContainerPadding = { top: number; right: number; bottom: number; left: number };

const PADDING_BY_TYPE: Record<string, ContainerPadding> = {
  serviceGroupNode: { top: 50, right: 20, bottom: 20, left: 20 },  // SVC_PAD_*
  layerNode:        { top: 36, right: 16, bottom: 16, left: 16 },  // LAYER_PAD_*
  moduleNode:       { top: 50, right: 8,  bottom: 8,  left: 8  },  // MODULE_NODE_HEIGHT header + MOD_PAD_X
};
const DEFAULT_PADDING: ContainerPadding = { top: 20, right: 20, bottom: 20, left: 20 };

function tightenContainers<T extends RawGraphNode>(rawNodes: T[]): T[] {
  if (rawNodes.length === 0) return rawNodes;

  const nodes = rawNodes.map((n) => ({
    ...n,
    position: { ...n.position },
    style: n.style ? { ...n.style } : undefined,
  })) as T[];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const childrenByParent = new Map<string, T[]>();
  for (const n of nodes) {
    if (n.parentId && byId.has(n.parentId)) {
      const bucket = childrenByParent.get(n.parentId) ?? ([] as T[]);
      bucket.push(n);
      childrenByParent.set(n.parentId, bucket);
    }
  }

  const depth = new Map<string, number>();
  const getDepth = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n || !n.parentId || !byId.has(n.parentId)) {
      depth.set(id, 0);
      return 0;
    }
    const d = getDepth(n.parentId) + 1;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) getDepth(n.id);

  const containers = nodes
    .filter((n) => childrenByParent.has(n.id))
    .sort((a, b) => getDepth(b.id) - getDepth(a.id));

  for (const container of containers) {
    const children = childrenByParent.get(container.id);
    if (!children || children.length === 0) continue;

    const pad = (container.type && PADDING_BY_TYPE[container.type]) || DEFAULT_PADDING;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of children) {
      const w = (c.style?.width as number | undefined) ?? 0;
      const h = (c.style?.height as number | undefined) ?? 0;
      minX = Math.min(minX, c.position.x);
      minY = Math.min(minY, c.position.y);
      maxX = Math.max(maxX, c.position.x + w);
      maxY = Math.max(maxY, c.position.y + h);
    }
    if (!isFinite(minX) || !isFinite(minY)) continue;

    // Shift children so the top-left child sits at (pad.left, pad.top) — under the header.
    const shiftX = minX - pad.left;
    const shiftY = minY - pad.top;
    if (shiftX !== 0 || shiftY !== 0) {
      for (const c of children) {
        c.position = { x: c.position.x - shiftX, y: c.position.y - shiftY };
      }
    }

    const newW = (maxX - minX) + pad.left + pad.right;
    const newH = (maxY - minY) + pad.top + pad.bottom;
    container.style = { ...(container.style ?? {}), width: newW, height: newH };

    // Shift container's own position to keep absolute placement of its contents approximately stable.
    container.position = {
      x: container.position.x + shiftX,
      y: container.position.y + shiftY,
    };
  }

  return nodes;
}

type UseGraphOptions = {
  branch?: string;
  level?: DepthLevel;
  analysisId?: string;
  scopedServiceId?: string | null;
  scopedModuleId?: string | null;
  /** When false, skip fetching. Use to defer the payload until the consuming tab is active. */
  enabled?: boolean;
};

export function useGraph(repoId: string, options: UseGraphOptions = {}) {
  const {
    branch,
    level = 'services',
    analysisId,
    scopedServiceId = null,
    scopedModuleId = null,
    enabled = true,
  } = options;

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [savedCollapsedIds, setSavedCollapsedIds] = useState<string[] | undefined>(undefined);
  const [scopes, setScopes] = useState<GraphScopes>({ services: [], modules: [] });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    if (!repoId) return;
    if (!enabled) {
      // Hook is gated off (tab not active) — clear loading state so UI doesn't spin.
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getGraph(repoId, { branch, level, analysisId });

      if (level === 'modules' || level === 'methods') {
        // Build parent-map + derive scope options from the raw payload
        const rawNodes = data.nodes;
        const rawEdges = data.edges;
        const nodeById = new Map(rawNodes.map((n) => [n.id, n]));

        const servicesList: GraphScopeOption[] = rawNodes
          .filter((n) => n.type === 'serviceGroupNode')
          .map((n) => ({ id: n.id, name: n.data.label }));

        const findService = (n: typeof rawNodes[number]): GraphScopeOption | null => {
          let current: typeof rawNodes[number] | undefined = n;
          while (current?.parentId) {
            const parent = nodeById.get(current.parentId);
            if (!parent) return null;
            if (parent.type === 'serviceGroupNode') return { id: parent.id, name: parent.data.label };
            current = parent;
          }
          return null;
        };

        const modulesList: GraphModuleOption[] = rawNodes
          .filter((n) => n.type === 'moduleNode')
          .map((n) => {
            const svc = findService(n);
            return {
              id: n.id,
              name: n.data.label,
              serviceId: svc?.id ?? '',
              serviceName: svc?.name ?? '',
            };
          });

        setScopes({ services: servicesList, modules: modulesList });

        // Apply scope filter — short-circuit when scope is required but unset
        let filteredNodes = rawNodes;
        let filteredEdges = rawEdges;

        if (level === 'modules') {
          if (!scopedServiceId) {
            // unset — empty state in the UI
            filteredNodes = [];
            filteredEdges = [];
          } else if (scopedServiceId === SCOPE_ALL) {
            // explicit "show everything" — use full server payload, no tightening needed
          } else {
            // specific service — keep its subtree + connected databases, then tighten
            const keep = new Set<string>();
            if (nodeById.has(scopedServiceId)) {
              keep.add(scopedServiceId);
              for (const n of rawNodes) {
                let ancestor = n.parentId ? nodeById.get(n.parentId) : undefined;
                while (ancestor) {
                  if (ancestor.id === scopedServiceId) {
                    keep.add(n.id);
                    break;
                  }
                  ancestor = ancestor.parentId ? nodeById.get(ancestor.parentId) : undefined;
                }
              }
              for (const e of rawEdges) {
                if (keep.has(e.source) || keep.has(e.target)) {
                  const src = nodeById.get(e.source);
                  const tgt = nodeById.get(e.target);
                  if (src?.type === 'databaseNode') keep.add(src.id);
                  if (tgt?.type === 'databaseNode') keep.add(tgt.id);
                }
              }
            }
            filteredNodes = rawNodes.filter((n) => keep.has(n.id));
            filteredEdges = rawEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
            filteredNodes = tightenContainers(filteredNodes);
          }
        } else {
          // methods
          if (!scopedModuleId) {
            // unset — empty state
            filteredNodes = [];
            filteredEdges = [];
          } else if (scopedModuleId === SCOPE_ALL) {
            if (scopedServiceId && scopedServiceId !== SCOPE_ALL) {
              // all modules of the selected service
              const keep = new Set<string>();
              if (nodeById.has(scopedServiceId)) {
                keep.add(scopedServiceId);
                for (const n of rawNodes) {
                  let ancestor = n.parentId ? nodeById.get(n.parentId) : undefined;
                  while (ancestor) {
                    if (ancestor.id === scopedServiceId) {
                      keep.add(n.id);
                      break;
                    }
                    ancestor = ancestor.parentId ? nodeById.get(ancestor.parentId) : undefined;
                  }
                }
                for (const e of rawEdges) {
                  if (keep.has(e.source) || keep.has(e.target)) {
                    const src = nodeById.get(e.source);
                    const tgt = nodeById.get(e.target);
                    if (src?.type === 'databaseNode') keep.add(src.id);
                    if (tgt?.type === 'databaseNode') keep.add(tgt.id);
                  }
                }
              }
              filteredNodes = rawNodes.filter((n) => keep.has(n.id));
              filteredEdges = rawEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
              filteredNodes = tightenContainers(filteredNodes);
            }
            // else: all services + all modules — full payload, no filter, no tighten
          } else {
            // specific module
            const keep = new Set<string>();
            const targetModule = nodeById.get(scopedModuleId);
            if (targetModule) {
              keep.add(targetModule.id);
              let anc = targetModule.parentId ? nodeById.get(targetModule.parentId) : undefined;
              while (anc) {
                keep.add(anc.id);
                anc = anc.parentId ? nodeById.get(anc.parentId) : undefined;
              }
              for (const n of rawNodes) {
                if (n.parentId === scopedModuleId) keep.add(n.id);
              }
              for (const e of rawEdges) {
                if (keep.has(e.source) || keep.has(e.target)) {
                  const src = nodeById.get(e.source);
                  const tgt = nodeById.get(e.target);
                  if (src?.type === 'databaseNode') keep.add(src.id);
                  if (tgt?.type === 'databaseNode') keep.add(tgt.id);
                }
              }
            }
            filteredNodes = rawNodes.filter((n) => keep.has(n.id));
            filteredEdges = rawEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
            filteredNodes = tightenContainers(filteredNodes);
          }
        }

        // Layer-level view: mix of serviceGroupNode, layerNode, and databaseNode types
        const graphNodes: Node[] = filteredNodes.map((node) => {
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
              style: node.style,
              data: { ...node.data, filePath: node.data.rootPath || '' },
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
                filePath: node.data.rootPath || '',
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
                filePaths: node.data.filePaths || [],
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
              rootPath: node.data.rootPath || '',
              violations: node.data.violations || [],
            },
          };
        });

        const graphEdges: Edge[] = filteredEdges.map((edge) => ({
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
        setSavedCollapsedIds(data.collapsedIds);
      } else {
        // Service-level view (scoping does not apply)
        setScopes({ services: [], modules: [] });

        const graphNodes: Node[] = data.nodes.map((node) => {
          if (node.type === 'databaseNode') {
            return {
              id: node.id,
              type: 'database' as const,
              position: node.position,
              data: buildDatabaseNodeData({
                label: node.data.label as string,
                databaseType: (node.data.databaseType as string | undefined) ?? (node.data.serviceType as string | undefined),
                tableCount: (node.data.tableCount as number | undefined) ?? (node.data.fileCount as number | undefined),
                connectedServices: node.data.connectedServices as string[] | undefined,
                framework: node.data.framework as string | undefined,
              }),
            };
          }

          return {
            id: node.id,
            type: 'service' as const,
            position: node.position,
            data: buildServiceNodeData({
              label: node.data.label as string,
              description: node.data.description as string | undefined,
              serviceType: node.data.serviceType as string | undefined,
              framework: node.data.framework as string | undefined,
              fileCount: node.data.fileCount as number | undefined,
              layers: node.data.layers as string[] | undefined,
              rootPath: node.data.rootPath as string | undefined,
            }),
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
        setSavedCollapsedIds(data.collapsedIds);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, branch, level, analysisId, scopedServiceId, scopedModuleId, enabled]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const result = useMemo(
    () => ({ nodes, edges, savedCollapsedIds, scopes, isLoading, error, refetch: fetchGraph, setNodes, setEdges }),
    [nodes, edges, savedCollapsedIds, scopes, isLoading, error, fetchGraph],
  );

  return result;
}
