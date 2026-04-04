/**
 * Semantic Zoom — pure functions for Google Maps-style zoom transitions.
 *
 * Zoom thresholds map the React Flow zoom scalar to discrete semantic levels:
 *   zoom <= 0.25  → services   (most zoomed out)
 *   zoom <= 0.45  → layers
 *   zoom <= 0.7   → directories
 *   zoom <= 1.2   → modules
 *   zoom >  1.2   → methods    (most zoomed in)
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { SemanticZoomLevel } from '@/types/graph';
import type { AllLevelGraphResponse } from '@/lib/api';

// ---------------------------------------------------------------------------
// Zoom level thresholds
// ---------------------------------------------------------------------------

const ZOOM_THRESHOLDS: { max: number; level: SemanticZoomLevel }[] = [
  { max: 0.25, level: 'services' },
  { max: 0.45, level: 'layers' },
  { max: 0.7, level: 'directories' },
  { max: 1.2, level: 'modules' },
  { max: Infinity, level: 'methods' },
];

export function getZoomLevel(zoom: number): SemanticZoomLevel {
  for (const t of ZOOM_THRESHOLDS) {
    if (zoom <= t.max) return t.level;
  }
  return 'methods';
}

// Ordered index for comparing levels
const LEVEL_ORDER: Record<SemanticZoomLevel, number> = {
  services: 0,
  layers: 1,
  directories: 2,
  modules: 3,
  methods: 4,
};

export function isLevelAtLeast(level: SemanticZoomLevel, target: SemanticZoomLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[target];
}

// ---------------------------------------------------------------------------
// Build visible nodes for a given zoom level
// ---------------------------------------------------------------------------

export function getVisibleNodes(
  data: AllLevelGraphResponse,
  zoomLevel: SemanticZoomLevel,
): Node[] {
  const nodes: Node[] = [];

  // Services are always visible (as either flat nodes or group containers)
  const isFlat = zoomLevel === 'services';

  for (const svc of data.services) {
    if (isFlat) {
      nodes.push({
        id: svc.id,
        type: 'service',
        position: { x: 0, y: 0 },
        data: {
          label: svc.name,
          description: svc.description || undefined,
          serviceInfo: {
            type: svc.type,
            framework: svc.framework,
            fileCount: svc.fileCount,
            layers: svc.layers.map((l) => ({ layer: l, confidence: 1, evidence: [] })),
            rootPath: svc.rootPath,
          },
          violationCount: 0,
          hasHighSeverity: false,
        },
      });
    } else {
      nodes.push({
        id: svc.id,
        type: 'serviceGroup',
        position: { x: 0, y: 0 },
        data: {
          label: svc.name,
          serviceType: svc.type,
          framework: svc.framework || undefined,
          fileCount: svc.fileCount,
          layers: svc.layers,
          rootPath: svc.rootPath,
        },
        style: { width: 400, height: 300 }, // will be resized by layout
      });
    }
  }

  // Layers visible from 'layers' level and deeper
  if (isLevelAtLeast(zoomLevel, 'layers')) {
    for (const layer of data.layers) {
      nodes.push({
        id: layer.id,
        type: 'layer',
        position: { x: 0, y: 0 },
        parentId: layer.serviceId,
        extent: 'parent' as const,
        data: {
          label: layer.layer,
          layer: layer.layer,
          fileCount: layer.fileCount,
          layerColor: layer.layerColor,
          fileNames: [],
          filePaths: layer.filePaths,
          isContainer: true,
        },
        style: { width: 350, height: 200 },
      });
    }
  }

  // Directories visible at 'directories' level
  if (zoomLevel === 'directories') {
    for (const dir of data.directories) {
      // Get display name (last segment of path)
      const parts = dir.dirPath.split('/');
      const displayName = parts[parts.length - 1] || dir.dirPath;
      nodes.push({
        id: dir.id,
        type: 'directory',
        position: { x: 0, y: 0 },
        parentId: dir.layerId,
        extent: 'parent' as const,
        data: {
          label: displayName,
          dirPath: dir.dirPath,
          moduleCount: dir.moduleCount,
          violationCount: dir.violationCount,
          layerColor: '', // will be filled from layer
        },
      });
    }
    // Fill layerColor from layer data
    const layerColorMap = new Map(data.layers.map((l) => [l.id, l.layerColor]));
    for (const node of nodes) {
      if (node.type === 'directory') {
        const dir = data.directories.find((d) => d.id === node.id);
        if (dir) {
          (node.data as Record<string, unknown>).layerColor = layerColorMap.get(dir.layerId) || '#6b7280';
        }
      }
    }
  }

  // Modules visible at 'modules' and 'methods' levels
  if (isLevelAtLeast(zoomLevel, 'modules')) {
    for (const mod of data.modules) {
      const isContainer = zoomLevel === 'methods';
      nodes.push({
        id: mod.id,
        type: 'module',
        position: { x: 0, y: 0 },
        parentId: mod.layerId,
        extent: 'parent' as const,
        data: {
          label: mod.name,
          moduleKind: mod.kind,
          methodCount: mod.methodCount,
          layerColor: mod.layerColor,
          isDead: false,
          isContainer,
          filePath: mod.filePath,
          rootPath: mod.filePath,
        },
      });
    }
  }

  // Methods visible at 'methods' level
  if (zoomLevel === 'methods') {
    for (const method of data.methods) {
      nodes.push({
        id: method.id,
        type: 'method',
        position: { x: 0, y: 0 },
        parentId: method.moduleId,
        extent: 'parent' as const,
        data: {
          label: method.name,
          signature: method.signature,
          isAsync: method.isAsync,
          isExported: method.isExported,
          lineCount: method.lineCount,
          filePath: '',
          rootPath: '',
        },
      });
    }
  }

  // Database nodes (always visible)
  for (const db of data.databases) {
    nodes.push({
      id: db.id,
      type: 'database',
      position: { x: 0, y: 0 },
      data: {
        label: db.name,
        databaseType: db.type,
        tableCount: db.tableCount,
        connectedServices: [],
        framework: db.driver,
      },
    });
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Aggregate edges to the currently visible level
// ---------------------------------------------------------------------------

export function aggregateEdges(
  data: AllLevelGraphResponse,
  zoomLevel: SemanticZoomLevel,
  visibleNodeIds: Set<string>,
): Edge[] {
  const edges: Edge[] = [];

  if (zoomLevel === 'services' || zoomLevel === 'layers' || zoomLevel === 'directories') {
    // At service/layer/directory level, use service-level edges
    for (const e of data.edges.service) {
      if (visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)) {
        edges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type === 'database' ? 'database' : 'dependency',
          data: {
            label: e.type === 'http'
              ? `${e.count} HTTP call${e.count !== 1 ? 's' : ''}`
              : `${e.count} import${e.count !== 1 ? 's' : ''}`,
            dependencyCount: e.count,
            hasHttpCalls: e.type === 'http',
          },
        });
      }
    }
  } else if (zoomLevel === 'modules') {
    // Module-level edges
    for (const e of data.edges.module) {
      if (visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)) {
        edges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'intraLayer',
          sourceHandle: 'right-src',
          targetHandle: 'right-tgt',
          data: {
            dependencyCount: e.count,
            label: '',
          },
        });
      }
    }
  } else {
    // Method-level edges
    for (const e of data.edges.method) {
      if (visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)) {
        edges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'intraLayer',
          sourceHandle: 'right-src',
          targetHandle: 'right-tgt',
          data: {
            dependencyCount: e.count,
            label: '',
          },
        });
      }
    }
  }

  // Database connection edges (always visible)
  for (const conn of data.dbConnections) {
    if (visibleNodeIds.has(conn.serviceId) && visibleNodeIds.has(conn.databaseId)) {
      edges.push({
        id: `db-${conn.serviceId}-${conn.databaseId}`,
        source: conn.serviceId,
        target: conn.databaseId,
        type: 'database',
        data: {
          dependencyCount: 1,
          label: '',
        },
      });
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Layout: run dagre on visible top-level nodes, position children relative
// ---------------------------------------------------------------------------

const NODE_WIDTHS: Record<string, number> = {
  service: 280,
  serviceGroup: 400,
  layer: 350,
  directory: 264,
  module: 264,
  method: 204,
  database: 200,
};

const NODE_HEIGHTS: Record<string, number> = {
  service: 120,
  serviceGroup: 300,
  layer: 200,
  directory: 50,
  module: 50,
  method: 32,
  database: 80,
};

export function computeLayoutForLevel(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  // Separate top-level nodes (no parentId) from children
  const topLevel = nodes.filter((n) => !(n as Record<string, unknown>).parentId);
  const children = nodes.filter((n) => (n as Record<string, unknown>).parentId);

  if (topLevel.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 150, ranksep: 200, marginx: 60, marginy: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  // Count children per parent to estimate container sizes
  const childCountByParent = new Map<string, number>();
  for (const child of children) {
    const pid = (child as Record<string, unknown>).parentId as string;
    childCountByParent.set(pid, (childCountByParent.get(pid) || 0) + 1);
  }

  for (const node of topLevel) {
    const type = node.type || 'service';
    const baseW = NODE_WIDTHS[type] || 280;
    const baseH = NODE_HEIGHTS[type] || 120;
    const childCount = childCountByParent.get(node.id) || 0;

    // Scale container size based on child count
    const w = childCount > 0 ? Math.max(baseW, 200 + childCount * 40) : baseW;
    const h = childCount > 0 ? Math.max(baseH, 150 + childCount * 30) : baseH;

    g.setNode(node.id, { width: w, height: h });
  }

  // Only add edges between top-level nodes
  const topLevelIds = new Set(topLevel.map((n) => n.id));
  for (const edge of edges) {
    if (topLevelIds.has(edge.source) && topLevelIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const positionMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of topLevel) {
    const dagreNode = g.node(node.id);
    if (dagreNode) {
      positionMap.set(node.id, {
        x: dagreNode.x - dagreNode.width / 2,
        y: dagreNode.y - dagreNode.height / 2,
        w: dagreNode.width,
        h: dagreNode.height,
      });
    }
  }

  // Position children in a grid within their parent
  const childrenByParent = new Map<string, Node[]>();
  for (const child of children) {
    const pid = (child as Record<string, unknown>).parentId as string;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid)!.push(child);
  }

  const childPositionMap = new Map<string, { x: number; y: number }>();
  for (const [parentId, parentChildren] of childrenByParent) {
    const parentLayout = positionMap.get(parentId);
    const padTop = 50;
    const padX = 16;
    const gap = 12;

    // Check if children themselves have children (containers)
    const hasGrandchildren = parentChildren.some((c) => childrenByParent.has(c.id));

    if (hasGrandchildren) {
      // Vertical stack for containers
      let y = padTop;
      for (const child of parentChildren) {
        const type = child.type || 'module';
        const w = NODE_WIDTHS[type] || 264;
        const grandchildCount = childCountByParent.get(child.id) || 0;
        const h = grandchildCount > 0 ? Math.max(NODE_HEIGHTS[type] || 50, 50 + grandchildCount * 30) : NODE_HEIGHTS[type] || 50;
        childPositionMap.set(child.id, { x: padX, y });
        y += h + gap;
      }

      // Update parent size
      if (parentLayout) {
        const totalH = parentChildren.reduce((sum, c) => {
          const type = c.type || 'module';
          const gc = childCountByParent.get(c.id) || 0;
          return sum + (gc > 0 ? Math.max(NODE_HEIGHTS[type] || 50, 50 + gc * 30) : NODE_HEIGHTS[type] || 50) + gap;
        }, padTop + 16);
        parentLayout.h = Math.max(parentLayout.h, totalH);
        const maxChildW = parentChildren.reduce((max, c) => {
          const type = c.type || 'module';
          const gc = childCountByParent.get(c.id) || 0;
          return Math.max(max, gc > 0 ? Math.max(NODE_WIDTHS[type] || 264, 200 + gc * 40) : NODE_WIDTHS[type] || 264);
        }, 0);
        parentLayout.w = Math.max(parentLayout.w, maxChildW + padX * 2);
      }
    } else {
      // Grid layout for leaf children
      const maxPerCol = 5;
      const childW = NODE_WIDTHS[parentChildren[0]?.type || 'module'] || 264;
      const childH = NODE_HEIGHTS[parentChildren[0]?.type || 'module'] || 50;
      const cols = Math.max(Math.ceil(parentChildren.length / maxPerCol), 1);

      for (let i = 0; i < parentChildren.length; i++) {
        const col = Math.floor(i / maxPerCol);
        const row = i % maxPerCol;
        childPositionMap.set(parentChildren[i].id, {
          x: padX + col * (childW + gap),
          y: padTop + row * (childH + gap),
        });
      }

      // Update parent size
      if (parentLayout) {
        const rows = Math.min(parentChildren.length, maxPerCol);
        parentLayout.w = Math.max(parentLayout.w, padX * 2 + cols * (childW + gap));
        parentLayout.h = Math.max(parentLayout.h, padTop + rows * (childH + gap) + 16);
      }
    }
  }

  // Build final positioned nodes
  return nodes.map((node) => {
    const pid = (node as Record<string, unknown>).parentId as string | undefined;
    if (!pid) {
      const pos = positionMap.get(node.id);
      if (!pos) return node;
      const type = node.type || 'service';
      const isContainer = type === 'serviceGroup' || childCountByParent.has(node.id);
      return {
        ...node,
        position: { x: pos.x, y: pos.y },
        ...(isContainer ? { style: { ...node.style, width: pos.w, height: pos.h } } : {}),
      };
    }
    const pos = childPositionMap.get(node.id);
    if (!pos) return node;

    // Size containers that have children
    const grandchildCount = childCountByParent.get(node.id) || 0;
    if (grandchildCount > 0) {
      const type = node.type || 'module';
      const w = Math.max(NODE_WIDTHS[type] || 264, 200 + grandchildCount * 40);
      const h = Math.max(NODE_HEIGHTS[type] || 50, 50 + grandchildCount * 30);
      return {
        ...node,
        position: pos,
        style: { ...node.style, width: w, height: h },
      };
    }
    return { ...node, position: pos };
  });
}
