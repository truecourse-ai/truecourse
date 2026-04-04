/**
 * Semantic Zoom — pure functions for Google Maps-style zoom transitions.
 *
 * Zoom thresholds map the React Flow zoom scalar to discrete semantic levels:
 *   zoom <= 0.25  → services   (most zoomed out)
 *   zoom <= 0.45  → layers
 *   zoom <= 0.7   → directories
 *   zoom <= 1.2   → modules
 *   zoom >  1.2   → methods    (most zoomed in)
 *
 * IMPORTANT: The base layout (service/database positions) is computed ONCE from
 * the full data and reused at every zoom level. Only the visible children change.
 * This prevents nodes from jumping when crossing zoom thresholds.
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
// Stable base layout — computed once, reused at every zoom level
// ---------------------------------------------------------------------------

export interface ZoomLayout {
  /** Positions for top-level nodes (services + databases) at this zoom level */
  positions: Map<string, { x: number; y: number; w: number; h: number }>;
  /** Computed layer sizes for this zoom level */
  layerSizes: Map<string, { w: number; h: number }>;
  /** Computed module sizes for this zoom level (only at methods level) */
  moduleSizes: Map<string, { w: number; h: number }>;
}

/**
 * Compute layout for a specific zoom level. Container sizes are computed
 * bottom-up (methods → modules → layers → services), then Dagre positions
 * the top-level nodes to avoid overlaps.
 *
 * Different zoom levels produce different service sizes (layers-only is compact,
 * methods-expanded is large), so Dagre runs per level. The relative ordering
 * stays consistent because the same edges/ranking are used.
 */
export function computeLayoutForZoom(
  data: AllLevelGraphResponse,
  zoomLevel: SemanticZoomLevel,
): ZoomLayout {
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

  // --- Bottom-up: compute module sizes (methods level) ---
  const moduleSizesMap = new Map<string, { w: number; h: number }>();
  if (zoomLevel === 'methods') {
    for (const mod of data.modules) {
      const methodCount = data.methods.filter((m) => m.moduleId === mod.id).length;
      const mMaxPerCol = 5;
      const mCols = Math.max(Math.ceil(methodCount / mMaxPerCol), 1);
      const mRows = Math.min(methodCount, mMaxPerCol);
      const w = Math.max(264, 16 * 2 + mCols * (204 + 8));
      const h = Math.max(60, 40 + mRows * (32 + 8) + 16);
      moduleSizesMap.set(mod.id, { w, h });
    }
  }

  // --- Bottom-up: compute layer sizes ---
  const layerSizesMap = new Map<string, { w: number; h: number }>();
  if (isLevelAtLeast(zoomLevel, 'layers')) {
    for (const layer of data.layers) {
      const size = computeLayerSizeDynamic(data, layer, zoomLevel, moduleSizesMap);
      layerSizesMap.set(layer.id, size);
    }
  }

  // --- Bottom-up: compute service sizes ---
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 150, ranksep: 200, marginx: 60, marginy: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const svc of data.services) {
    if (zoomLevel === 'services') {
      // Flat service card
      g.setNode(svc.id, { width: 280, height: 120 });
    } else {
      // Container — size from layers
      const svcLayers = data.layers.filter((l) => l.serviceId === svc.id);
      const svcPadX = 20;
      const svcPadTop = 50;
      const svcPadBottom = 20;
      const layerGap = 12;

      let totalH = svcPadTop;
      let maxW = 350;
      for (const layer of svcLayers) {
        const ls = layerSizesMap.get(layer.id) || { w: 350, h: 60 };
        maxW = Math.max(maxW, ls.w);
        totalH += ls.h + layerGap;
      }
      totalH += svcPadBottom;
      const svcW = maxW + svcPadX * 2;
      const svcH = Math.max(200, totalH);

      g.setNode(svc.id, { width: svcW, height: svcH });
    }
  }

  // Database nodes
  for (const db of data.databases) {
    g.setNode(db.id, { width: 200, height: 80 });
  }

  // Edges for ranking
  for (const e of data.edges.service) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  for (const conn of data.dbConnections) {
    if (g.hasNode(conn.serviceId) && g.hasNode(conn.databaseId)) {
      g.setEdge(conn.serviceId, conn.databaseId);
    }
  }

  dagre.layout(g);

  for (const svc of data.services) {
    const n = g.node(svc.id);
    if (n) {
      positions.set(svc.id, { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height });
    }
  }
  for (const db of data.databases) {
    const n = g.node(db.id);
    if (n) {
      positions.set(db.id, { x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height });
    }
  }

  return { positions, layerSizes: layerSizesMap, moduleSizes: moduleSizesMap };
}

// ---------------------------------------------------------------------------
// Build visible nodes for a given zoom level using stable base positions
// ---------------------------------------------------------------------------

export function getVisibleNodes(
  data: AllLevelGraphResponse,
  zoomLevel: SemanticZoomLevel,
  layout: ZoomLayout,
): Node[] {
  const nodes: Node[] = [];
  const isFlat = zoomLevel === 'services';

  // Use pre-computed sizes from the layout
  const { layerSizes, moduleSizes } = layout;

  // --- Services: position and size from layout (Dagre-computed for this level) ---
  for (const svc of data.services) {
    const pos = layout.positions.get(svc.id) || { x: 0, y: 0, w: 400, h: 300 };

    if (isFlat) {
      nodes.push({
        id: svc.id,
        type: 'service',
        position: { x: pos.x, y: pos.y },
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
        position: { x: pos.x, y: pos.y },
        data: {
          label: svc.name,
          serviceType: svc.type,
          framework: svc.framework || undefined,
          fileCount: svc.fileCount,
          layers: svc.layers,
          rootPath: svc.rootPath,
        },
        style: { width: pos.w, height: pos.h },
      });
    }
  }

  // --- Layers: positioned within their service group ---
  if (isLevelAtLeast(zoomLevel, 'layers')) {
    const layersByService = new Map<string, typeof data.layers>();
    for (const layer of data.layers) {
      if (!layersByService.has(layer.serviceId)) layersByService.set(layer.serviceId, []);
      layersByService.get(layer.serviceId)!.push(layer);
    }

    for (const [_serviceId, svcLayers] of layersByService) {
      let yOffset = 50; // top padding inside service group
      for (const layer of svcLayers) {
        const ls = layerSizes.get(layer.id) || { w: 350, h: 60 };

        nodes.push({
          id: layer.id,
          type: 'layer',
          position: { x: 16, y: yOffset },
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
          style: { width: ls.w, height: ls.h },
        });

        yOffset += ls.h + 12;
      }
    }
  }

  // --- Directories: positioned within their layer ---
  if (zoomLevel === 'directories') {
    const dirsByLayer = new Map<string, typeof data.directories>();
    for (const dir of data.directories) {
      if (!dirsByLayer.has(dir.layerId)) dirsByLayer.set(dir.layerId, []);
      dirsByLayer.get(dir.layerId)!.push(dir);
    }

    const layerColorMap = new Map(data.layers.map((l) => [l.id, l.layerColor]));

    for (const [_layerId, layerDirs] of dirsByLayer) {
      const maxPerCol = 5;
      const dirW = 264;
      const dirH = 50;
      const gap = 12;
      const padX = 16;
      const padTop = 36;

      for (let i = 0; i < layerDirs.length; i++) {
        const dir = layerDirs[i];
        const col = Math.floor(i / maxPerCol);
        const row = i % maxPerCol;
        const parts = dir.dirPath.split('/');
        const displayName = parts[parts.length - 1] || dir.dirPath;

        nodes.push({
          id: dir.id,
          type: 'directory',
          position: { x: padX + col * (dirW + gap), y: padTop + row * (dirH + gap) },
          parentId: dir.layerId,
          extent: 'parent' as const,
          data: {
            label: displayName,
            dirPath: dir.dirPath,
            moduleCount: dir.moduleCount,
            violationCount: dir.violationCount,
            layerColor: layerColorMap.get(dir.layerId) || '#6b7280',
          },
        });
      }
    }
  }

  // --- Modules: positioned within their layer ---
  if (isLevelAtLeast(zoomLevel, 'modules')) {
    const modulesByLayer = new Map<string, typeof data.modules>();
    for (const mod of data.modules) {
      if (!modulesByLayer.has(mod.layerId)) modulesByLayer.set(mod.layerId, []);
      modulesByLayer.get(mod.layerId)!.push(mod);
    }

    const isContainer = zoomLevel === 'methods';

    for (const [_layerId, layerModules] of modulesByLayer) {
      const maxPerCol = 5;
      const modW = 264;
      const modH = isContainer ? 100 : 50;
      const gap = 12;
      const padX = 16;
      const padTop = 36;

      // At methods level, use actual module sizes for positioning (variable height)
      if (isContainer) {
        let yOffset = padTop;
        for (const mod of layerModules) {
          const ms = moduleSizes.get(mod.id) || { w: modW, h: 100 };
          nodes.push({
            id: mod.id,
            type: 'module',
            position: { x: padX, y: yOffset },
            parentId: mod.layerId,
            extent: 'parent' as const,
            data: {
              label: mod.name,
              moduleKind: mod.kind,
              methodCount: mod.methodCount,
              layerColor: mod.layerColor,
              isDead: false,
              isContainer: true,
              filePath: mod.filePath,
              rootPath: mod.filePath,
            },
            style: { width: ms.w, height: ms.h },
          });
          yOffset += ms.h + gap;
        }
      } else {
        for (let i = 0; i < layerModules.length; i++) {
          const mod = layerModules[i];
          const col = Math.floor(i / maxPerCol);
          const row = i % maxPerCol;
          nodes.push({
            id: mod.id,
            type: 'module',
            position: { x: padX + col * (modW + gap), y: padTop + row * (modH + gap) },
            parentId: mod.layerId,
            extent: 'parent' as const,
            data: {
              label: mod.name,
              moduleKind: mod.kind,
              methodCount: mod.methodCount,
              layerColor: mod.layerColor,
              isDead: false,
              isContainer: false,
              filePath: mod.filePath,
              rootPath: mod.filePath,
            },
          });
        }
      }
    }
  }

  // --- Methods: positioned within their module ---
  if (zoomLevel === 'methods') {
    const methodsByModule = new Map<string, typeof data.methods>();
    for (const method of data.methods) {
      if (!methodsByModule.has(method.moduleId)) methodsByModule.set(method.moduleId, []);
      methodsByModule.get(method.moduleId)!.push(method);
    }

    for (const [_moduleId, moduleMethods] of methodsByModule) {
      const maxPerCol = 5;
      const methW = 204;
      const methH = 32;
      const gap = 8;
      const padX = 8;
      const padTop = 36;

      for (let i = 0; i < moduleMethods.length; i++) {
        const method = moduleMethods[i];
        const col = Math.floor(i / maxPerCol);
        const row = i % maxPerCol;

        nodes.push({
          id: method.id,
          type: 'method',
          position: { x: padX + col * (methW + gap), y: padTop + row * (methH + gap) },
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
  }

  // --- Database nodes: always visible, stable positions ---
  for (const db of data.databases) {
    const pos = baseLayout.positions.get(db.id) || { x: 0, y: 0 };
    nodes.push({
      id: db.id,
      type: 'database',
      position: { x: pos.x, y: pos.y },
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
// Compute layer size based on content at the current zoom level
// ---------------------------------------------------------------------------

function computeLayerSizeDynamic(
  data: AllLevelGraphResponse,
  layer: AllLevelGraphResponse['layers'][0],
  zoomLevel: SemanticZoomLevel,
  moduleSizes: Map<string, { w: number; h: number }>,
): { w: number; h: number } {
  const padX = 16;
  const padTop = 36;
  const padBottom = 16;
  const gap = 12;

  if (zoomLevel === 'layers') {
    return { w: 350, h: 60 };
  }

  if (zoomLevel === 'directories') {
    const dirs = data.directories.filter((d) => d.layerId === layer.id);
    const count = dirs.length;
    if (count === 0) return { w: 350, h: 60 };
    const maxPerCol = 5;
    const cols = Math.max(Math.ceil(count / maxPerCol), 1);
    const rows = Math.min(count, maxPerCol);
    return {
      w: padX * 2 + cols * (264 + gap),
      h: padTop + rows * (50 + gap) + padBottom,
    };
  }

  // modules level — grid layout
  if (zoomLevel === 'modules') {
    const mods = data.modules.filter((m) => m.layerId === layer.id);
    const count = mods.length;
    if (count === 0) return { w: 350, h: 60 };
    const maxPerCol = 5;
    const cols = Math.max(Math.ceil(count / maxPerCol), 1);
    const rows = Math.min(count, maxPerCol);
    return {
      w: padX * 2 + cols * (264 + gap),
      h: padTop + rows * (50 + gap) + padBottom,
    };
  }

  // methods level — modules are stacked vertically with variable heights
  const mods = data.modules.filter((m) => m.layerId === layer.id);
  if (mods.length === 0) return { w: 350, h: 60 };

  let totalH = padTop;
  let maxW = 264;
  for (const mod of mods) {
    const ms = moduleSizes.get(mod.id) || { w: 264, h: 100 };
    maxW = Math.max(maxW, ms.w);
    totalH += ms.h + gap;
  }
  totalH += padBottom;
  return { w: padX * 2 + maxW, h: totalH };
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
