import dagre from 'dagre';
import { isFrameworkEntryFile } from '@truecourse/analyzer';

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    serviceType: string;
    framework?: string;
    fileCount: number;
    layers: string[];
    rootPath: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data: {
    dependencyCount: number;
    dependencyType?: string;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface ServiceData {
  id: string;
  name: string;
  type: string;
  framework: string | null;
  fileCount: number | null;
  description: string | null;
  layerSummary: unknown;
  rootPath: string;
}

interface DependencyData {
  id: string;
  sourceServiceId: string;
  targetServiceId: string;
  dependencyCount: number | null;
  dependencyType: string | null;
}

/**
 * Get the rank/tier for dagre layout based on service type.
 * Lower rank = higher on the graph.
 */
function getServiceRank(type: string): number {
  switch (type) {
    case 'frontend':
      return 0;
    case 'api-server':
      return 1;
    case 'worker':
      return 2;
    case 'library':
      return 3;
    case 'unknown':
    default:
      return 2;
  }
}

interface DatabaseData {
  id: string;
  name: string;
  type: string;
  driver: string;
  tables: unknown;
  connectedServices: unknown;
}

interface DatabaseConnectionData {
  id: string;
  serviceId: string;
  databaseId: string;
  driver: string;
}

// ---------------------------------------------------------------------------
// Shared dagre layout — consistent service + database ordering across all modes
// ---------------------------------------------------------------------------

interface NodeDimension {
  width: number;
  height: number;
}

interface OuterLayoutResult {
  servicePositions: Map<string, { x: number; y: number }>;
  databasePositions: Map<string, { x: number; y: number }>;
}

/**
 * Compute consistent service and database positions using dagre.
 * All depth levels call this with their actual group sizes so the relative
 * ordering is identical but spacing adapts to prevent overlap.
 */
function computeOuterLayout(
  services: ServiceData[],
  serviceDeps: DependencyData[],
  serviceDimensions: Map<string, NodeDimension>,
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
): OuterLayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    nodesep: 150,
    ranksep: 200,
    marginx: 60,
    marginy: 60,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Sort services by rank for consistent ordering
  const sortedServices = [...services].sort(
    (a, b) => getServiceRank(a.type) - getServiceRank(b.type)
  );

  for (const service of sortedServices) {
    const dim = serviceDimensions.get(service.id) || { width: 280, height: 120 };
    g.setNode(service.id, {
      width: dim.width,
      height: dim.height,
      rank: getServiceRank(service.type),
    });
  }

  // Service-level dependency edges
  for (const dep of serviceDeps) {
    g.setEdge(dep.sourceServiceId, dep.targetServiceId);
  }

  // Include databases in the dagre graph so they're positioned relative to connected services
  if (databasesList && databasesList.length > 0) {
    for (const dbData of databasesList) {
      g.setNode(dbData.id, {
        width: 200,
        height: 80,
        rank: 4, // Below all services
      });
    }

    if (databaseConnectionsList) {
      for (const conn of databaseConnectionsList) {
        g.setEdge(conn.serviceId, conn.databaseId);
      }
    }
  }

  dagre.layout(g);

  const servicePositions = new Map<string, { x: number; y: number }>();
  for (const service of services) {
    const pos = g.node(service.id);
    const dim = serviceDimensions.get(service.id) || { width: 280, height: 120 };
    servicePositions.set(service.id, {
      x: pos.x - dim.width / 2,
      y: pos.y - dim.height / 2,
    });
  }

  const databasePositions = new Map<string, { x: number; y: number }>();
  if (databasesList) {
    for (const dbData of databasesList) {
      const pos = g.node(dbData.id);
      databasePositions.set(dbData.id, {
        x: pos.x - 100,
        y: pos.y - 40,
      });
    }
  }

  return { servicePositions, databasePositions };
}

export function buildGraphData(
  services: ServiceData[],
  dependencies: DependencyData[],
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
): GraphData {
  const SERVICE_W = 280;
  const SERVICE_H = 120;

  const dimensions = new Map<string, NodeDimension>();
  for (const service of services) {
    dimensions.set(service.id, { width: SERVICE_W, height: SERVICE_H });
  }

  const { servicePositions, databasePositions } = computeOuterLayout(
    services, dependencies, dimensions, databasesList, databaseConnectionsList,
  );

  // Build graph nodes
  const nodes: GraphNode[] = services.map((service) => {
    const pos = servicePositions.get(service.id)!;
    const layers = extractLayers(service.layerSummary);

    return {
      id: service.id,
      type: 'serviceNode',
      position: pos,
      data: {
        label: service.name,
        description: service.description || undefined,
        serviceType: service.type,
        framework: service.framework || undefined,
        fileCount: service.fileCount || 0,
        layers,
        rootPath: service.rootPath,
      },
    };
  });

  // Build graph edges
  const edges: GraphEdge[] = dependencies.map((dep) => ({
    id: dep.id,
    source: dep.sourceServiceId,
    target: dep.targetServiceId,
    label: dep.dependencyCount ? `${dep.dependencyCount}` : undefined,
    data: {
      dependencyCount: dep.dependencyCount || 0,
      dependencyType: dep.dependencyType || undefined,
    },
    ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
  }));

  // Add database nodes + edges
  addDatabaseNodesFromLayout(nodes, edges, databasePositions, databasesList, databaseConnectionsList);

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Layer-level graph data
// ---------------------------------------------------------------------------

interface LayerData {
  id: string;
  serviceName: string;
  serviceId: string;
  layer: string;
  fileCount: number;
  filePaths: string[];
  confidence: number;
  evidence: string[];
}

interface LayerDepData {
  id: string;
  sourceServiceName: string;
  sourceLayer: string;
  targetServiceName: string;
  targetLayer: string;
  dependencyCount: number;
  isViolation: boolean;
  violationReason: string | null;
}

const LAYER_ORDER: Record<string, number> = {
  api: 0,
  service: 1,
  data: 2,
  external: 3,
};

const LAYER_COLORS: Record<string, string> = {
  api: '#3b82f6',      // blue
  service: '#8b5cf6',  // purple
  data: '#10b981',     // emerald
  external: '#f97316', // orange
};

export function buildLayerGraphData(
  servicesList: ServiceData[],
  serviceDeps: DependencyData[],
  layersList: LayerData[],
  layerDeps: LayerDepData[],
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Build a map of serviceName → serviceId
  const serviceNameToId = new Map<string, string>();
  for (const svc of servicesList) {
    serviceNameToId.set(svc.name, svc.id);
  }

  // Group layers by service
  const layersByService = groupBy(layersList, (l) => l.serviceName);

  // Calculate group sizes based on layer count
  const SERVICE_GROUP_WIDTH = 320;
  const LAYER_NODE_BASE_HEIGHT = 36; // header row
  const LAYER_NODE_FILE_LINE = 18;   // per file line
  const LAYER_NODE_SECTION_GAP = 4;  // border-t gap between sections
  const MAX_FILES_SHOWN = 5;         // cap visible files
  const LAYER_GAP = 24;
  const GROUP_PADDING_TOP = 50; // space for group header
  const GROUP_PADDING_BOTTOM = 20;
  const GROUP_PADDING_X = 20;

  function getLayerNodeHeight(fileCount: number): number {
    const shown = Math.min(fileCount, MAX_FILES_SHOWN);
    const extra = fileCount > MAX_FILES_SHOWN ? 1 : 0; // "+N more" line
    const fileSection = shown > 0 ? (shown + extra) * LAYER_NODE_FILE_LINE + LAYER_NODE_SECTION_GAP : 0;
    return LAYER_NODE_BASE_HEIGHT + fileSection;
  }

  // Compute group dimensions
  const dimensions = new Map<string, NodeDimension>();
  const groupHeights = new Map<string, number>();

  for (const service of servicesList) {
    const svcLayers = layersByService.get(service.name) || [];
    const layerCount = Math.max(svcLayers.length, 1);
    let totalLayerHeight = 0;
    for (const l of svcLayers) {
      totalLayerHeight += getLayerNodeHeight(l.fileCount);
    }
    if (svcLayers.length === 0) totalLayerHeight = LAYER_NODE_BASE_HEIGHT;
    const groupHeight =
      GROUP_PADDING_TOP +
      totalLayerHeight +
      (layerCount - 1) * LAYER_GAP +
      GROUP_PADDING_BOTTOM;

    dimensions.set(service.id, { width: SERVICE_GROUP_WIDTH, height: groupHeight });
    groupHeights.set(service.id, groupHeight);
  }

  const { servicePositions, databasePositions } = computeOuterLayout(
    servicesList, serviceDeps, dimensions, databasesList, databaseConnectionsList,
  );

  // Create group nodes (service containers) and layer sub-nodes
  for (const service of servicesList) {
    const pos = servicePositions.get(service.id)!;
    const svcLayers = (layersByService.get(service.name) || []).sort(
      (a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99)
    );

    const groupHeight = groupHeights.get(service.id)!;
    const groupX = pos.x;
    const groupY = pos.y;

    // Service group node
    const layerNodeWidth = SERVICE_GROUP_WIDTH - GROUP_PADDING_X * 2;

    nodes.push({
      id: service.id,
      type: 'serviceGroupNode',
      position: { x: groupX, y: groupY },
      data: {
        label: service.name,
        description: service.description || undefined,
        serviceType: service.type,
        framework: service.framework || undefined,
        fileCount: service.fileCount || 0,
        layers: svcLayers.map((l) => l.layer),
        rootPath: service.rootPath,
      },
      ...(({ style: { width: SERVICE_GROUP_WIDTH, height: groupHeight } }) as Record<string, unknown>),
    });

    // Layer sub-nodes (positioned relative to parent group)
    let yOffset = GROUP_PADDING_TOP;
    for (let i = 0; i < svcLayers.length; i++) {
      const layer = svcLayers[i];
      const layerNodeId = `${service.id}__${layer.layer}`;
      const nodeHeight = getLayerNodeHeight(layer.fileCount);

      // Extract just file names (not full paths) for display
      const fileNames = layer.filePaths.map((fp) => fp.split('/').pop() || fp);

      nodes.push({
        id: layerNodeId,
        type: 'layerNode',
        position: {
          x: GROUP_PADDING_X,
          y: yOffset,
        },
        data: {
          label: layer.layer,
          description: undefined,
          serviceType: service.type,
          framework: undefined,
          fileCount: layer.fileCount,
          layers: [layer.layer],
          rootPath: service.rootPath,
          ...(({ layerColor: LAYER_COLORS[layer.layer] || '#6b7280', fileNames }) as Record<string, unknown>),
        },
        ...(({ parentId: service.id, extent: 'parent' }) as Record<string, unknown>),
      });

      yOffset += nodeHeight + LAYER_GAP;
    }
  }

  // Intra-service layer deps: React Flow edges using right-side handles
  for (const dep of layerDeps) {
    if (dep.sourceServiceName !== dep.targetServiceName) continue;
    const svcId = serviceNameToId.get(dep.sourceServiceName);
    if (!svcId) continue;

    const sourceNodeId = `${svcId}__${dep.sourceLayer}`;
    const targetNodeId = `${svcId}__${dep.targetLayer}`;

    edges.push({
      id: dep.id,
      source: sourceNodeId,
      target: targetNodeId,
      label: dep.dependencyCount > 0 ? `${dep.dependencyCount}` : undefined,
      data: {
        dependencyCount: dep.dependencyCount,
        dependencyType: dep.isViolation ? 'violation' : 'intra-layer-dep',
        ...(dep.isViolation
          ? ({ isViolation: true, violationReason: dep.violationReason } as Record<string, unknown>)
          : {}),
      },
      ...({ sourceHandle: 'right-src', targetHandle: 'right-tgt' } as Record<string, unknown>),
    });
  }

  // Cross-service layer deps: vertical edges (bottom → top handles)
  for (const dep of layerDeps) {
    if (dep.sourceServiceName === dep.targetServiceName) continue;
    const srcServiceId = serviceNameToId.get(dep.sourceServiceName);
    const tgtServiceId = serviceNameToId.get(dep.targetServiceName);
    if (!srcServiceId || !tgtServiceId) continue;

    const sourceNodeId = `${srcServiceId}__${dep.sourceLayer}`;
    const targetNodeId = `${tgtServiceId}__${dep.targetLayer}`;

    edges.push({
      id: dep.id,
      source: sourceNodeId,
      target: targetNodeId,
      label: dep.dependencyCount > 0 ? `${dep.dependencyCount}` : undefined,
      data: {
        dependencyCount: dep.dependencyCount,
        dependencyType: dep.isViolation ? 'violation' : 'layer-dep',
        ...(dep.isViolation
          ? ({ isViolation: true, violationReason: dep.violationReason } as Record<string, unknown>)
          : {}),
      },
      ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
    });
  }

  // HTTP service deps: map to layer-level edges (external → api)
  for (const dep of serviceDeps) {
    if (dep.dependencyType !== 'http') continue;
    // Find suitable source and target layers
    const srcLayers = layersByService.get(
      servicesList.find((s) => s.id === dep.sourceServiceId)?.name || ''
    ) || [];
    const tgtLayers = layersByService.get(
      servicesList.find((s) => s.id === dep.targetServiceId)?.name || ''
    ) || [];

    const srcLayer = srcLayers.find((l) => l.layer === 'external')
      || srcLayers.find((l) => l.layer === 'service')
      || srcLayers[0];
    const tgtLayer = tgtLayers.find((l) => l.layer === 'api')
      || tgtLayers[0];

    if (!srcLayer || !tgtLayer) continue;

    const sourceNodeId = `${dep.sourceServiceId}__${srcLayer.layer}`;
    const targetNodeId = `${dep.targetServiceId}__${tgtLayer.layer}`;

    // Avoid duplicate edges
    if (edges.some((e) => e.source === sourceNodeId && e.target === targetNodeId)) continue;

    edges.push({
      id: `http-${dep.id}`,
      source: sourceNodeId,
      target: targetNodeId,
      data: {
        dependencyCount: dep.dependencyCount || 0,
        dependencyType: 'http',
      },
      ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
    });
  }

  // Inject violation info into service group nodes
  const violationsByService = new Map<string, { edgeId: string; sourceLayer: string; targetLayer: string; reason: string }[]>();
  for (const dep of layerDeps) {
    if (!dep.isViolation) continue;
    const svcId = serviceNameToId.get(dep.sourceServiceName);
    if (!svcId) continue;
    if (!violationsByService.has(svcId)) violationsByService.set(svcId, []);
    violationsByService.get(svcId)!.push({
      edgeId: dep.id,
      sourceLayer: dep.sourceLayer,
      targetLayer: dep.targetLayer,
      reason: dep.violationReason || 'Architectural violation',
    });
  }
  for (const node of nodes) {
    if (node.type !== 'serviceGroupNode') continue;
    const violations = violationsByService.get(node.id);
    if (violations) {
      (node.data as Record<string, unknown>).violations = violations;
    }
  }

  // Inject violation info into layer nodes (source layers of violations)
  const violationsByLayer = new Map<string, { targetLayer: string; reason: string; edgeId: string }[]>();
  for (const dep of layerDeps) {
    if (!dep.isViolation) continue;
    const svcId = serviceNameToId.get(dep.sourceServiceName);
    if (!svcId) continue;
    const layerNodeId = `${svcId}__${dep.sourceLayer}`;
    if (!violationsByLayer.has(layerNodeId)) violationsByLayer.set(layerNodeId, []);
    violationsByLayer.get(layerNodeId)!.push({
      targetLayer: dep.targetLayer,
      reason: dep.violationReason || 'Architectural violation',
      edgeId: dep.id,
    });
  }
  for (const node of nodes) {
    if (node.type !== 'layerNode') continue;
    const layerViolations = violationsByLayer.get(node.id);
    if (layerViolations) {
      (node.data as Record<string, unknown>).violations = layerViolations;
    }
  }

  // Add database nodes (positioned by shared dagre layout)
  addDatabaseNodesFromLayout(nodes, edges, databasePositions, databasesList, databaseConnectionsList);

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Module-level graph data
// ---------------------------------------------------------------------------

interface ModuleData {
  id: string;
  layerId: string;
  serviceId: string;
  name: string;
  kind: string;
  filePath: string;
  methodCount: number;
  propertyCount: number;
  importCount: number;
  exportCount: number;
  superClass: string | null;
  lineCount: number | null;
}

interface ModuleDepData {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  importedNames: unknown;
  dependencyCount: number;
}

interface MethodData {
  id: string;
  moduleId: string;
  name: string;
  signature: string;
  paramCount: number;
  returnType: string | null;
  isAsync: boolean;
  isExported: boolean;
  lineCount: number | null;
  statementCount: number | null;
  maxNestingDepth: number | null;
}

interface MethodDepData {
  id: string;
  sourceMethodId: string;
  targetMethodId: string;
  callCount: number;
}

const MODULE_NODE_WIDTH = 264;
const MODULE_NODE_HEIGHT = 50;
const MODULE_GAP = 16;

export function buildModuleGraphData(
  servicesList: ServiceData[],
  layersList: LayerData[],
  modulesList: ModuleData[],
  moduleDepsList: ModuleDepData[],
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
  layerDeps?: LayerDepData[],
  serviceDeps?: DependencyData[],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Group layers by service, modules by layer
  const layersByService = groupBy(layersList, (l) => l.serviceId);
  const modulesByLayer = groupBy(modulesList, (m) => m.layerId);

  // Calculate sizes
  const GROUP_PAD_TOP = 50;
  const GROUP_PAD_BOTTOM = 20;
  const GROUP_PAD_X = 20;
  const LAYER_PAD_TOP = 32;
  const LAYER_PAD_BOTTOM = 12;
  const LAYER_GAP = 24;

  const MAX_PER_COL = 5;
  const MOD_COL_GAP = 16;

  function getModColCount(itemCount: number): number {
    return Math.max(Math.ceil(itemCount / MAX_PER_COL), 1);
  }

  function getModuleLayerHeight(layerId: string): number {
    const mods = modulesByLayer.get(layerId) || [];
    const cols = getModColCount(mods.length);
    const rowCount = Math.max(Math.ceil(mods.length / cols), 1);
    return LAYER_PAD_TOP + rowCount * MODULE_NODE_HEIGHT + (rowCount - 1) * MODULE_GAP + LAYER_PAD_BOTTOM;
  }

  // Compute dimensions for shared layout
  const serviceGroupWidths = new Map<string, number>();
  const dimensions = new Map<string, NodeDimension>();
  const groupHeights = new Map<string, number>();

  for (const service of servicesList) {
    const svcLayers = layersByService.get(service.id) || [];
    let totalHeight = GROUP_PAD_TOP + GROUP_PAD_BOTTOM;

    // Find max column count across all layers in this service for consistent width
    let maxCols = 1;
    for (const l of svcLayers) {
      const mods = modulesByLayer.get(l.id) || [];
      maxCols = Math.max(maxCols, getModColCount(mods.length));
    }

    for (const l of svcLayers) {
      totalHeight += getModuleLayerHeight(l.id) + LAYER_GAP;
    }
    if (svcLayers.length > 0) totalHeight -= LAYER_GAP;
    if (svcLayers.length === 0) totalHeight += MODULE_NODE_HEIGHT;

    const groupWidth = Math.max(320, maxCols * MODULE_NODE_WIDTH + (maxCols - 1) * MOD_COL_GAP + GROUP_PAD_X * 2 + 24);
    serviceGroupWidths.set(service.id, groupWidth);
    dimensions.set(service.id, { width: groupWidth, height: totalHeight });
    groupHeights.set(service.id, totalHeight);
  }

  const svcDeps = aggregateCrossServiceDeps(moduleDepsList, modulesList);

  const { servicePositions, databasePositions } = computeOuterLayout(
    servicesList, svcDeps, dimensions, databasesList, databaseConnectionsList,
  );

  // Create nodes
  for (const service of servicesList) {
    const pos = servicePositions.get(service.id)!;
    const groupWidth = serviceGroupWidths.get(service.id) || 320;
    const totalHeight = groupHeights.get(service.id)!;
    const svcLayers = (layersByService.get(service.id) || []).sort(
      (a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99)
    );

    nodes.push(createServiceGroupNode(service, pos, svcLayers, groupWidth, totalHeight));

    // Layer container nodes + module sub-nodes
    let yOffset = GROUP_PAD_TOP;
    for (const layer of svcLayers) {
      const layerNodeId = `${service.id}__${layer.layer}`;
      const layerHeight = getModuleLayerHeight(layer.id);
      const layerWidth = groupWidth - GROUP_PAD_X * 2;

      nodes.push(createLayerContainerNode(
        service.id, layer, service.type, service.rootPath,
        { x: GROUP_PAD_X, y: yOffset }, layerWidth, layerHeight,
      ));

      // Module nodes inside layer — dynamic column grid
      const mods = modulesByLayer.get(layer.id) || [];
      const LAYER_PAD_X = 12;
      const modCols = getModColCount(mods.length);
      for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        const col = i % modCols;
        const row = Math.floor(i / modCols);
        const modX = LAYER_PAD_X + col * (MODULE_NODE_WIDTH + MOD_COL_GAP);
        const modYPos = LAYER_PAD_TOP + row * (MODULE_NODE_HEIGHT + MODULE_GAP);
        nodes.push({
          id: mod.id,
          type: 'moduleNode',
          position: { x: modX, y: modYPos },
          data: {
            label: mod.name,
            serviceType: mod.kind,
            fileCount: mod.methodCount,
            layers: [layer.layer],
            rootPath: mod.filePath,
            description: undefined,
            framework: undefined,
            ...(({
              moduleKind: mod.kind,
              methodCount: mod.methodCount,
              propertyCount: mod.propertyCount,
              importCount: mod.importCount,
              exportCount: mod.exportCount,
              superClass: mod.superClass,
              layerColor: LAYER_COLORS[layer.layer] || '#6b7280',
            }) as Record<string, unknown>),
          },
          ...(({ parentId: layerNodeId, extent: 'parent', style: { width: MODULE_NODE_WIDTH } }) as Record<string, unknown>),
        });
      }

      yOffset += layerHeight + LAYER_GAP;
    }
  }

  markDeadModules(nodes, modulesList, moduleDepsList, layersList, databasesList, databaseConnectionsList);

  // Module dependency edges
  edges.push(...createModuleDepEdges(moduleDepsList, modulesList));

  // HTTP service deps: map to module-level edges (external module → api module)
  if (serviceDeps) {
    for (const dep of serviceDeps) {
      if (dep.dependencyType !== 'http') continue;
      const srcServiceName = servicesList.find((s) => s.id === dep.sourceServiceId)?.name || '';
      const tgtServiceName = servicesList.find((s) => s.id === dep.targetServiceId)?.name || '';

      const srcLayers = layersByService.get(dep.sourceServiceId) || [];
      const tgtLayers = layersByService.get(dep.targetServiceId) || [];

      const srcLayer = srcLayers.find((l) => l.layer === 'external')
        || srcLayers.find((l) => l.layer === 'service')
        || srcLayers[0];
      const tgtLayer = tgtLayers.find((l) => l.layer === 'api')
        || tgtLayers[0];

      if (!srcLayer || !tgtLayer) continue;

      const srcMods = modulesByLayer.get(srcLayer.id) || [];
      const tgtMods = modulesByLayer.get(tgtLayer.id) || [];
      const srcMod = srcMods[0];
      const tgtMod = tgtMods[0];
      if (!srcMod || !tgtMod) continue;

      if (edges.some((e) => e.source === srcMod.id && e.target === tgtMod.id)) continue;

      edges.push({
        id: `http-mod-${dep.id}`,
        source: srcMod.id,
        target: tgtMod.id,
        data: {
          dependencyCount: dep.dependencyCount || 0,
          dependencyType: 'http',
        },
        ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
      });
    }
  }

  // Inject layer violation info onto module edges and service group nodes
  if (layerDeps && layerDeps.length > 0) {
    injectModuleViolations(nodes, edges, modulesList, layersList, servicesList, layerDeps, moduleDepsList);
  }

  // Database nodes (positioned by shared dagre layout)
  addDatabaseNodesFromLayout(nodes, edges, databasePositions, databasesList, databaseConnectionsList, modulesList, layersList);

  return { nodes, edges };
}

export function buildMethodGraphData(
  servicesList: ServiceData[],
  layersList: LayerData[],
  modulesList: ModuleData[],
  methodsList: MethodData[],
  moduleDepsList: ModuleDepData[],
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
  layerDeps?: LayerDepData[],
  methodDepsList?: MethodDepData[],
  serviceDeps?: DependencyData[],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Group layers by service, modules by layer, methods by module
  const layersByService = groupBy(layersList, (l) => l.serviceId);
  const modulesByLayer = groupBy(modulesList, (m) => m.layerId);
  const methodsByModule = groupBy(methodsList, (m) => m.moduleId);

  const METHOD_NODE_HEIGHT = 32;
  const METHOD_GAP = 8;
  const MOD_PAD_TOP = 32;
  const MOD_PAD_BOTTOM = 8;
  const MOD_PAD_X = 8;
  const METHOD_COL_GAP = 8;
  const MOD_COL_GAP = 16;
  const MAX_PER_COL = 5;

  function getColCount(itemCount: number): number {
    return Math.max(Math.ceil(itemCount / MAX_PER_COL), 1);
  }

  const METHOD_NODE_WIDTH = 204;

  function getModuleHeight(moduleId: string): number {
    const mths = methodsByModule.get(moduleId) || [];
    const cols = getColCount(mths.length);
    const rowCount = Math.max(Math.ceil(mths.length / cols), 1);
    return MOD_PAD_TOP + rowCount * METHOD_NODE_HEIGHT + (rowCount - 1) * METHOD_GAP + MOD_PAD_BOTTOM;
  }

  function getModuleWidth(moduleId: string): number {
    const mths = methodsByModule.get(moduleId) || [];
    const cols = getColCount(mths.length);
    return MOD_PAD_X * 2 + cols * METHOD_NODE_WIDTH + (cols - 1) * METHOD_COL_GAP;
  }

  const GROUP_PAD_TOP = 50;
  const GROUP_PAD_BOTTOM = 20;
  const GROUP_PAD_X = 20;
  const LAYER_PAD_TOP = 32;
  const LAYER_PAD_BOTTOM = 12;
  const LAYER_GAP = 24;

  function getLayerHeight(layerId: string): number {
    const mods = modulesByLayer.get(layerId) || [];
    if (mods.length === 0) return LAYER_PAD_TOP + MODULE_NODE_HEIGHT + LAYER_PAD_BOTTOM;
    const modCols = getColCount(mods.length);
    const rowCount = Math.ceil(mods.length / modCols);
    let h = LAYER_PAD_TOP + LAYER_PAD_BOTTOM;
    for (let r = 0; r < rowCount; r++) {
      let maxH = 0;
      for (let c = 0; c < modCols; c++) {
        const mod = mods[r * modCols + c];
        if (mod) maxH = Math.max(maxH, getModuleHeight(mod.id));
      }
      h += maxH + MODULE_GAP;
    }
    h -= MODULE_GAP; // remove trailing gap
    return h;
  }

  const MIN_MODULE_WIDTH = 180;
  const serviceGroupWidths = new Map<string, number>();
  const dimensions = new Map<string, NodeDimension>();
  const groupHeights = new Map<string, number>();

  // Compute per-layer content width (sum of per-column max module widths)
  function getLayerContentWidth(layerId: string): number {
    const mods = modulesByLayer.get(layerId) || [];
    if (mods.length === 0) return MIN_MODULE_WIDTH;
    const modCols = getColCount(mods.length);
    // Compute max module width per column
    const colWidths: number[] = new Array(modCols).fill(MIN_MODULE_WIDTH);
    for (let i = 0; i < mods.length; i++) {
      const col = i % modCols;
      colWidths[col] = Math.max(colWidths[col], getModuleWidth(mods[i].id));
    }
    return colWidths.reduce((sum, w) => sum + w, 0) + (modCols - 1) * MOD_COL_GAP;
  }

  for (const service of servicesList) {
    const svcLayers = layersByService.get(service.id) || [];
    let totalHeight = GROUP_PAD_TOP + GROUP_PAD_BOTTOM;
    for (const l of svcLayers) {
      totalHeight += getLayerHeight(l.id) + LAYER_GAP;
    }
    if (svcLayers.length > 0) totalHeight -= LAYER_GAP;
    if (svcLayers.length === 0) totalHeight += MODULE_NODE_HEIGHT;

    // Service width = widest layer content + padding
    let maxLayerContent = MIN_MODULE_WIDTH;
    for (const l of svcLayers) {
      maxLayerContent = Math.max(maxLayerContent, getLayerContentWidth(l.id));
    }

    const groupWidth = Math.max(360, maxLayerContent + 2 * 12 + GROUP_PAD_X * 2);
    serviceGroupWidths.set(service.id, groupWidth);
    dimensions.set(service.id, { width: groupWidth, height: totalHeight });
    groupHeights.set(service.id, totalHeight);
  }

  const svcDeps = aggregateCrossServiceDeps(moduleDepsList, modulesList);

  const { servicePositions, databasePositions } = computeOuterLayout(
    servicesList, svcDeps, dimensions, databasesList, databaseConnectionsList,
  );

  for (const service of servicesList) {
    const pos = servicePositions.get(service.id)!;
    const groupWidth = serviceGroupWidths.get(service.id) || 360;
    const totalHeight = groupHeights.get(service.id)!;
    const svcLayers = (layersByService.get(service.id) || []).sort(
      (a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99)
    );

    nodes.push(createServiceGroupNode(service, pos, svcLayers, groupWidth, totalHeight));

    let yOffset = GROUP_PAD_TOP;
    for (const layer of svcLayers) {
      const layerNodeId = `${service.id}__${layer.layer}`;
      const layerHeight = getLayerHeight(layer.id);
      const layerWidth = groupWidth - GROUP_PAD_X * 2;

      nodes.push(createLayerContainerNode(
        service.id, layer, service.type, service.rootPath,
        { x: GROUP_PAD_X, y: yOffset }, layerWidth, layerHeight,
      ));

      // Module containers inside layer — dynamic column grid with per-column widths
      const mods = modulesByLayer.get(layer.id) || [];
      const LAYER_PAD_X_INNER = 12;
      const modCols = getColCount(mods.length);

      // Compute per-column widths based on actual module content
      const modColWidths: number[] = new Array(modCols).fill(MIN_MODULE_WIDTH);
      for (let i = 0; i < mods.length; i++) {
        const col = i % modCols;
        modColWidths[col] = Math.max(modColWidths[col], getModuleWidth(mods[i].id));
      }

      // Compute column x offsets
      const modColOffsets: number[] = [];
      let xOff = LAYER_PAD_X_INNER;
      for (let c = 0; c < modCols; c++) {
        modColOffsets.push(xOff);
        xOff += modColWidths[c] + MOD_COL_GAP;
      }

      // Pre-compute row heights (max across columns in each row)
      const modRowCount = Math.ceil(mods.length / modCols);
      const modRowHeights: number[] = [];
      for (let r = 0; r < modRowCount; r++) {
        let maxH = 0;
        for (let c = 0; c < modCols; c++) {
          const mod = mods[r * modCols + c];
          if (mod) maxH = Math.max(maxH, getModuleHeight(mod.id));
        }
        modRowHeights.push(maxH);
      }

      for (let i = 0; i < mods.length; i++) {
        const mod = mods[i];
        const col = i % modCols;
        const row = Math.floor(i / modCols);
        const modX = modColOffsets[col];
        let modYPos = LAYER_PAD_TOP;
        for (let r = 0; r < row; r++) {
          modYPos += modRowHeights[r] + MODULE_GAP;
        }
        const modHeight = getModuleHeight(mod.id);
        const modWidth = Math.max(MIN_MODULE_WIDTH, getModuleWidth(mod.id));

        nodes.push({
          id: mod.id,
          type: 'moduleNode',
          position: { x: modX, y: modYPos },
          data: {
            label: mod.name,
            serviceType: mod.kind,
            fileCount: mod.methodCount,
            layers: [layer.layer],
            rootPath: mod.filePath,
            description: undefined,
            framework: undefined,
            ...(({
              moduleKind: mod.kind,
              methodCount: mod.methodCount,
              layerColor: LAYER_COLORS[layer.layer] || '#6b7280',
              isContainer: true,
            }) as Record<string, unknown>),
          },
          ...(({
            parentId: layerNodeId,
            extent: 'parent',
            style: { width: modWidth, height: modHeight },
          }) as Record<string, unknown>),
        });

        // Method nodes inside module — dynamic column grid
        const mths = methodsByModule.get(mod.id) || [];
        const mthCols = getColCount(mths.length);
        const methodColWidth = (modWidth - 2 * MOD_PAD_X - (mthCols - 1) * METHOD_COL_GAP) / mthCols;
        for (let j = 0; j < mths.length; j++) {
          const mth = mths[j];
          const mCol = j % mthCols;
          const mRow = Math.floor(j / mthCols);
          const mthX = MOD_PAD_X + mCol * (methodColWidth + METHOD_COL_GAP);
          const mthY = MOD_PAD_TOP + mRow * (METHOD_NODE_HEIGHT + METHOD_GAP);
          nodes.push({
            id: mth.id,
            type: 'methodNode',
            position: { x: mthX, y: mthY },
            data: {
              label: mth.name,
              serviceType: 'method',
              fileCount: 0,
              layers: [],
              rootPath: '',
              description: mth.signature,
              framework: undefined,
              ...(({
                signature: mth.signature,
                paramCount: mth.paramCount,
                returnType: mth.returnType,
                isAsync: mth.isAsync,
                isExported: mth.isExported,
                lineCount: mth.lineCount,
                statementCount: mth.statementCount,
                maxNestingDepth: mth.maxNestingDepth,
              }) as Record<string, unknown>),
            },
            ...(({
              parentId: mod.id,
              extent: 'parent',
              style: { width: methodColWidth },
            }) as Record<string, unknown>),
          });
        }
      }

      yOffset += layerHeight + LAYER_GAP;
    }
  }

  markDeadModules(nodes, modulesList, moduleDepsList, layersList, databasesList, databaseConnectionsList);

  // Method dependency edges (call-level relationships between methods)
  if (methodDepsList && methodDepsList.length > 0) {
    edges.push(...createMethodDepEdges(methodDepsList, methodsList, modulesList));
  }

  // Add module-level dep edges where no method-level edges exist between the same modules.
  // This ensures import-only relationships (no actual method calls) still show as edges.
  const methodModuleMap = new Map<string, string>();
  for (const m of methodsList) {
    const mod = modulesList.find((mod) => mod.id === m.moduleId);
    if (mod) methodModuleMap.set(m.id, mod.id);
  }
  const connectedModulePairs = new Set<string>();
  for (const edge of edges) {
    const srcMod = methodModuleMap.get(edge.source);
    const tgtMod = methodModuleMap.get(edge.target);
    if (srcMod && tgtMod) connectedModulePairs.add(`${srcMod}::${tgtMod}`);
  }
  for (const dep of moduleDepsList) {
    const srcMod = modulesList.find((m) => m.id === dep.sourceModuleId);
    const tgtMod = modulesList.find((m) => m.id === dep.targetModuleId);
    if (!srcMod || !tgtMod) continue;
    if (connectedModulePairs.has(`${srcMod.id}::${tgtMod.id}`)) continue;
    const isSameService = srcMod.serviceId === tgtMod.serviceId;
    edges.push({
      id: `mod-${dep.id}`,
      source: dep.sourceModuleId,
      target: dep.targetModuleId,
      label: String(dep.dependencyCount),
      data: {
        dependencyCount: dep.dependencyCount,
        dependencyType: 'module-dep',
      },
      ...(isSameService
        ? ({ sourceHandle: 'right-src', targetHandle: 'right-tgt' } as Record<string, unknown>)
        : ({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>)),
    });
  }

  // HTTP service deps: map to module-level edges (external module → api module)
  if (serviceDeps) {
    for (const dep of serviceDeps) {
      if (dep.dependencyType !== 'http') continue;

      const srcLayers = layersByService.get(dep.sourceServiceId) || [];
      const tgtLayers = layersByService.get(dep.targetServiceId) || [];

      const srcLayer = srcLayers.find((l) => l.layer === 'external')
        || srcLayers.find((l) => l.layer === 'service')
        || srcLayers[0];
      const tgtLayer = tgtLayers.find((l) => l.layer === 'api')
        || tgtLayers[0];

      if (!srcLayer || !tgtLayer) continue;

      const srcMods = modulesByLayer.get(srcLayer.id) || [];
      const tgtMods = modulesByLayer.get(tgtLayer.id) || [];
      const srcMod = srcMods[0];
      const tgtMod = tgtMods[0];
      if (!srcMod || !tgtMod) continue;

      if (edges.some((e) => e.source === srcMod.id && e.target === tgtMod.id)) continue;

      edges.push({
        id: `http-mth-${dep.id}`,
        source: srcMod.id,
        target: tgtMod.id,
        data: {
          dependencyCount: dep.dependencyCount || 0,
          dependencyType: 'http',
        },
        ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
      });
    }
  }

  // Mark dead methods (no method deps)
  markDeadMethods(nodes, methodDepsList || []);

  // Inject layer violation info onto edges and service group nodes
  if (layerDeps && layerDeps.length > 0) {
    injectModuleViolations(nodes, edges, modulesList, layersList, servicesList, layerDeps, moduleDepsList);
  }

  // Database nodes (positioned by shared dagre layout)
  addDatabaseNodesFromLayout(nodes, edges, databasePositions, databasesList, databaseConnectionsList, modulesList, layersList);

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Shared helpers — deduplicated logic used across multiple graph builders
// ---------------------------------------------------------------------------

/**
 * Group items into a Map by a key extracted from each item.
 */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }
  return map;
}

/**
 * Aggregate module-level cross-service deps into service-level DependencyData.
 */
function aggregateCrossServiceDeps(
  moduleDepsList: ModuleDepData[],
  modulesList: ModuleData[],
): DependencyData[] {
  return moduleDepsList
    .filter((d) => {
      const srcMod = modulesList.find((m) => m.id === d.sourceModuleId);
      const tgtMod = modulesList.find((m) => m.id === d.targetModuleId);
      return srcMod && tgtMod && srcMod.serviceId !== tgtMod.serviceId;
    })
    .reduce<DependencyData[]>((acc, d) => {
      const srcMod = modulesList.find((m) => m.id === d.sourceModuleId)!;
      const tgtMod = modulesList.find((m) => m.id === d.targetModuleId)!;
      const existing = acc.find(
        (a) => a.sourceServiceId === srcMod.serviceId && a.targetServiceId === tgtMod.serviceId,
      );
      if (!existing) {
        acc.push({
          id: `svc-dep-${srcMod.serviceId}-${tgtMod.serviceId}`,
          sourceServiceId: srcMod.serviceId,
          targetServiceId: tgtMod.serviceId,
          dependencyCount: d.dependencyCount,
          dependencyType: 'import',
        });
      }
      return acc;
    }, []);
}

/**
 * Create a service group node.
 */
function createServiceGroupNode(
  service: ServiceData,
  position: { x: number; y: number },
  svcLayers: LayerData[],
  width: number,
  height: number,
): GraphNode {
  return {
    id: service.id,
    type: 'serviceGroupNode',
    position,
    data: {
      label: service.name,
      description: service.description || undefined,
      serviceType: service.type,
      framework: service.framework || undefined,
      fileCount: service.fileCount || 0,
      layers: svcLayers.map((l) => l.layer),
      rootPath: service.rootPath,
    },
    ...(({ style: { width, height } }) as Record<string, unknown>),
  };
}

/**
 * Create a layer container node (used in module and method depth levels).
 */
function createLayerContainerNode(
  serviceId: string,
  layer: LayerData,
  serviceType: string,
  rootPath: string,
  position: { x: number; y: number },
  width: number,
  height: number,
): GraphNode {
  const layerNodeId = `${serviceId}__${layer.layer}`;
  return {
    id: layerNodeId,
    type: 'layerNode',
    position,
    data: {
      label: layer.layer,
      serviceType,
      fileCount: layer.fileCount,
      layers: [layer.layer],
      rootPath,
      description: undefined,
      framework: undefined,
      ...(({
        layerColor: LAYER_COLORS[layer.layer] || '#6b7280',
        isContainer: true,
      }) as Record<string, unknown>),
    },
    ...(({
      parentId: serviceId,
      extent: 'parent',
      style: { width, height },
    }) as Record<string, unknown>),
  };
}

/**
 * Create module dependency edges with same-service vs cross-service handle routing.
 */
function createModuleDepEdges(
  moduleDepsList: ModuleDepData[],
  modulesList: ModuleData[],
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const dep of moduleDepsList) {
    const srcMod = modulesList.find((m) => m.id === dep.sourceModuleId);
    const tgtMod = modulesList.find((m) => m.id === dep.targetModuleId);
    if (!srcMod || !tgtMod) continue;

    const isSameService = srcMod.serviceId === tgtMod.serviceId;

    edges.push({
      id: dep.id,
      source: dep.sourceModuleId,
      target: dep.targetModuleId,
      label: String(dep.dependencyCount),
      data: {
        dependencyCount: dep.dependencyCount,
        dependencyType: 'module-dep',
      },
      ...(isSameService
        ? ({ sourceHandle: 'right-src', targetHandle: 'right-tgt' } as Record<string, unknown>)
        : ({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>)),
    });
  }
  return edges;
}

/**
 * Create method dependency edges with routing based on relationship:
 * - Same module: right-side handles (like intra-service module edges)
 * - Same service, different module: right-side handles
 * - Cross-service: top/bottom handles
 */
function createMethodDepEdges(
  methodDepsList: MethodDepData[],
  methodsList: MethodData[],
  modulesList: ModuleData[],
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // Build method → module lookup
  const methodModuleMap = new Map<string, ModuleData>();
  for (const method of methodsList) {
    const mod = modulesList.find((m) => m.id === method.moduleId);
    if (mod) methodModuleMap.set(method.id, mod);
  }

  for (const dep of methodDepsList) {
    const srcMod = methodModuleMap.get(dep.sourceMethodId);
    const tgtMod = methodModuleMap.get(dep.targetMethodId);
    if (!srcMod || !tgtMod) continue;

    const isSameService = srcMod.serviceId === tgtMod.serviceId;

    edges.push({
      id: dep.id,
      source: dep.sourceMethodId,
      target: dep.targetMethodId,
      label: dep.callCount > 1 ? String(dep.callCount) : undefined,
      data: {
        dependencyCount: dep.callCount,
        dependencyType: 'method-dep',
      },
      ...(isSameService
        ? ({ sourceHandle: 'right-src', targetHandle: 'right-tgt' } as Record<string, unknown>)
        : ({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>)),
    });
  }
  return edges;
}

/**
 * Mark modules with no dependencies (and no database connections) as dead.
 * Used by both buildModuleGraphData and buildMethodGraphData.
 */
function markDeadModules(
  nodes: GraphNode[],
  modulesList: ModuleData[],
  moduleDepsList: ModuleDepData[],
  layersList: LayerData[],
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
) {
  const connectedModuleIds = new Set<string>();
  for (const dep of moduleDepsList) {
    connectedModuleIds.add(dep.sourceModuleId);
    connectedModuleIds.add(dep.targetModuleId);
  }
  if (databaseConnectionsList && databasesList) {
    for (const conn of databaseConnectionsList) {
      const dataLayer = layersList.find(
        (l) => l.serviceId === conn.serviceId && l.layer === 'data',
      );
      if (dataLayer) {
        const dataModules = modulesList.filter((m) => m.layerId === dataLayer.id);
        if (dataModules.length > 0) {
          const driverLower = conn.driver.toLowerCase();
          const dbData = databasesList.find((d) => d.id === conn.databaseId);
          const dbNameLower = dbData?.name.toLowerCase() || '';
          const matched = dataModules.find((m) => {
            const nameLower = m.name.toLowerCase();
            return nameLower.includes(driverLower) || driverLower.includes(nameLower)
              || nameLower.includes(dbNameLower) || dbNameLower.includes(nameLower);
          });
          connectedModuleIds.add(matched?.id || dataModules[0].id);
        }
      }
    }
  }
  for (const node of nodes) {
    if (node.type === 'moduleNode') {
      const mod = modulesList.find((m) => m.id === node.id);
      if (mod && !connectedModuleIds.has(mod.id) && !isFrameworkEntryFile(mod.filePath)) {
        (node.data as Record<string, unknown>).isDead = true;
      }
    }
  }
}

/**
 * Mark methods with no incoming or outgoing method dependencies as dead.
 */
function markDeadMethods(
  nodes: GraphNode[],
  methodDepsList: MethodDepData[],
) {
  const connectedMethodIds = new Set<string>();
  for (const dep of methodDepsList) {
    connectedMethodIds.add(dep.sourceMethodId);
    connectedMethodIds.add(dep.targetMethodId);
  }
  for (const node of nodes) {
    if (node.type === 'methodNode' && !connectedMethodIds.has(node.id)) {
      (node.data as Record<string, unknown>).isDead = true;
    }
  }
}

/**
 * Tag module edges as violations and inject violation badges (with actual edge IDs)
 * into service group nodes. Used by both buildModuleGraphData and buildMethodGraphData.
 */
function injectModuleViolations(
  nodes: GraphNode[],
  edges: GraphEdge[],
  modulesList: ModuleData[],
  layersList: LayerData[],
  servicesList: ServiceData[],
  layerDeps: LayerDepData[],
  moduleDepsList?: ModuleDepData[],
) {
  // Build lookup: moduleId → { serviceName, layer }
  const moduleLayerLookup = new Map<string, { serviceName: string; layer: string }>();
  for (const mod of modulesList) {
    const layer = layersList.find((l) => l.id === mod.layerId);
    const svc = servicesList.find((s) => s.id === mod.serviceId);
    if (layer && svc) {
      moduleLayerLookup.set(mod.id, { serviceName: svc.name, layer: layer.layer });
    }
  }

  // Build violation lookup: "serviceName::sourceLayer::targetLayer" → violation info
  const violationLookup = new Map<string, LayerDepData>();
  for (const dep of layerDeps) {
    if (!dep.isViolation) continue;
    violationLookup.set(`${dep.sourceServiceName}::${dep.sourceLayer}::${dep.targetLayer}`, dep);
  }

  // Tag module edges that cross violation boundaries, collect edge IDs per violation
  // Key: "svcId::sourceLayer::targetLayer" → list of module edge IDs
  const violationEdgeIds = new Map<string, string[]>();
  const serviceNameToId = new Map<string, string>();
  for (const svc of servicesList) serviceNameToId.set(svc.name, svc.id);

  // Build method → module lookup (for method-mode edges)
  const methodToModule = new Map<string, string>();
  for (const node of nodes) {
    const parentId = (node as unknown as Record<string, unknown>).parentId as string | undefined;
    if (node.type === 'methodNode' && parentId) {
      methodToModule.set(node.id, parentId);
    }
  }

  for (const edge of edges) {
    // Resolve to module IDs: direct for module edges, via parentId for method edges
    const srcModuleId = moduleLayerLookup.has(edge.source) ? edge.source : methodToModule.get(edge.source);
    const tgtModuleId = moduleLayerLookup.has(edge.target) ? edge.target : methodToModule.get(edge.target);
    const srcInfo = srcModuleId ? moduleLayerLookup.get(srcModuleId) : undefined;
    const tgtInfo = tgtModuleId ? moduleLayerLookup.get(tgtModuleId) : undefined;
    if (!srcInfo || !tgtInfo) continue;
    if (srcInfo.layer === tgtInfo.layer) continue;

    const key = `${srcInfo.serviceName}::${srcInfo.layer}::${tgtInfo.layer}`;
    const violation = violationLookup.get(key);
    if (violation) {
      (edge.data as Record<string, unknown>).isViolation = true;
      (edge.data as Record<string, unknown>).violationReason = violation.violationReason;
      edge.data.dependencyType = 'violation';

      const svcId = serviceNameToId.get(srcInfo.serviceName);
      if (svcId) {
        const groupKey = `${svcId}::${srcInfo.layer}::${tgtInfo.layer}`;
        if (!violationEdgeIds.has(groupKey)) violationEdgeIds.set(groupKey, []);
        violationEdgeIds.get(groupKey)!.push(edge.id);
      }
    }
  }

  // Build violation badges for service group nodes using actual module edge IDs
  const violationsByService = new Map<string, { edgeIds: string[]; sourceLayer: string; targetLayer: string; reason: string }[]>();
  for (const dep of layerDeps) {
    if (!dep.isViolation) continue;
    const svcId = serviceNameToId.get(dep.sourceServiceName);
    if (!svcId) continue;

    const groupKey = `${svcId}::${dep.sourceLayer}::${dep.targetLayer}`;
    const edgeIds = violationEdgeIds.get(groupKey) || [];

    if (!violationsByService.has(svcId)) violationsByService.set(svcId, []);
    violationsByService.get(svcId)!.push({
      edgeIds,
      sourceLayer: dep.sourceLayer,
      targetLayer: dep.targetLayer,
      reason: dep.violationReason || 'Architectural violation',
    });
  }
  for (const node of nodes) {
    if (node.type !== 'serviceGroupNode') continue;
    const violations = violationsByService.get(node.id);
    if (violations) {
      (node.data as Record<string, unknown>).violations = violations;
    }
  }

  // Inject violation info into source module nodes
  // Use module-level dependency data: for each module, check if it has outgoing
  // edges to modules in a different layer that cross a violation boundary.
  const violationsByModule = new Map<string, { targetLayer: string; reason: string; edgeIds: string[] }[]>();

  // First try from tagged edges (works in module mode where edges connect modules)
  for (const edge of edges) {
    if (!(edge.data as Record<string, unknown>).isViolation) continue;
    const srcInfo = moduleLayerLookup.get(edge.source);
    const tgtInfo = moduleLayerLookup.get(edge.target);
    if (!srcInfo || !tgtInfo) continue;
    if (!violationsByModule.has(edge.source)) violationsByModule.set(edge.source, []);
    violationsByModule.get(edge.source)!.push({
      targetLayer: tgtInfo.layer,
      reason: (edge.data as Record<string, unknown>).violationReason as string || 'Architectural violation',
      edgeIds: [edge.id],
    });
  }

  // Also tag modules from module-level dependencies directly (works in method mode
  // where graph edges are between methods, not modules)
  if (moduleDepsList) {
    for (const dep of moduleDepsList) {
      if (violationsByModule.has(dep.sourceModuleId)) continue;
      const srcInfo = moduleLayerLookup.get(dep.sourceModuleId);
      const tgtInfo = moduleLayerLookup.get(dep.targetModuleId);
      if (!srcInfo || !tgtInfo || srcInfo.layer === tgtInfo.layer) continue;
      const key = `${srcInfo.serviceName}::${srcInfo.layer}::${tgtInfo.layer}`;
      const violation = violationLookup.get(key);
      if (violation) {
        if (!violationsByModule.has(dep.sourceModuleId)) violationsByModule.set(dep.sourceModuleId, []);
        // Find all violation edges related to this module dep
        const relatedEdgeIds = edges
          .filter((e) => (e.data as Record<string, unknown>).isViolation && (
            e.source === dep.sourceModuleId || e.target === dep.targetModuleId
          ))
          .map((e) => e.id);
        violationsByModule.get(dep.sourceModuleId)!.push({
          targetLayer: tgtInfo.layer,
          reason: violation.violationReason || 'Architectural violation',
          edgeIds: relatedEdgeIds,
        });
      }
    }
  }

  for (const node of nodes) {
    if (node.type !== 'moduleNode') continue;
    const moduleViolations = violationsByModule.get(node.id);
    if (moduleViolations) {
      (node.data as Record<string, unknown>).violations = moduleViolations;
    }
  }

  // Inject violation info into layer container nodes
  // Key layer node IDs as "serviceId__layerName"
  const violationsByLayer = new Map<string, { targetLayer: string; reason: string; edgeIds: string[] }[]>();
  for (const dep of layerDeps) {
    if (!dep.isViolation) continue;
    const svcId = serviceNameToId.get(dep.sourceServiceName);
    if (!svcId) continue;
    const layerNodeId = `${svcId}__${dep.sourceLayer}`;
    const groupKey = `${svcId}::${dep.sourceLayer}::${dep.targetLayer}`;
    const edgeIds = violationEdgeIds.get(groupKey) || [];
    if (!violationsByLayer.has(layerNodeId)) violationsByLayer.set(layerNodeId, []);
    violationsByLayer.get(layerNodeId)!.push({
      targetLayer: dep.targetLayer,
      reason: dep.violationReason || 'Architectural violation',
      edgeIds,
    });
  }
  for (const node of nodes) {
    if (node.type !== 'layerNode') continue;
    const layerViolations = violationsByLayer.get(node.id);
    if (layerViolations) {
      (node.data as Record<string, unknown>).violations = layerViolations;
    }
  }
}

/**
 * Add database nodes using pre-computed positions from shared dagre layout.
 */
function addDatabaseNodesFromLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  databasePositions: Map<string, { x: number; y: number }>,
  databasesList?: DatabaseData[],
  databaseConnectionsList?: DatabaseConnectionData[],
  modulesList?: ModuleData[],
  layersList?: LayerData[],
) {
  if (!databasesList || databasesList.length === 0) return;

  for (const dbData of databasesList) {
    const pos = databasePositions.get(dbData.id);
    if (!pos) continue;
    const tableCount = Array.isArray(dbData.tables) ? dbData.tables.length : 0;
    const connectedSvcs = Array.isArray(dbData.connectedServices) ? dbData.connectedServices : [];

    nodes.push({
      id: dbData.id,
      type: 'databaseNode',
      position: pos,
      data: {
        label: dbData.name,
        serviceType: dbData.type,
        framework: dbData.driver,
        fileCount: tableCount,
        layers: [],
        rootPath: '',
        ...({ databaseType: dbData.type, tableCount, connectedServices: connectedSvcs } as Record<string, unknown>),
      },
    });
  }

  if (databaseConnectionsList) {
    for (const conn of databaseConnectionsList) {
      // In module/method mode, connect from the specific module in the data layer
      let sourceId = conn.serviceId;
      if (modulesList && layersList) {
        const dataLayer = layersList.find(
          (l) => l.serviceId === conn.serviceId && l.layer === 'data',
        );
        if (dataLayer) {
          const dataModules = modulesList.filter((m) => m.layerId === dataLayer.id);
          if (dataModules.length > 0) {
            // Try to find module matching the DB driver/name
            const driverLower = conn.driver.toLowerCase();
            const dbData = databasesList?.find((d) => d.id === conn.databaseId);
            const dbNameLower = dbData?.name.toLowerCase() || '';
            const matched = dataModules.find((m) => {
              const nameLower = m.name.toLowerCase();
              return nameLower.includes(driverLower) || driverLower.includes(nameLower)
                || nameLower.includes(dbNameLower) || dbNameLower.includes(nameLower);
            });
            sourceId = matched?.id || dataModules[0].id;
          }
        }
      } else {
        // In layer mode, connect from data layer node
        const dataLayerNodeId = `${conn.serviceId}__data`;
        const hasDataLayer = nodes.some((n) => n.id === dataLayerNodeId);
        if (hasDataLayer) sourceId = dataLayerNodeId;
      }

      edges.push({
        id: `db-${conn.id}`,
        source: sourceId,
        target: conn.databaseId,
        label: conn.driver,
        data: {
          dependencyCount: 0,
          dependencyType: 'database',
        },
        ...({ sourceHandle: 'bottom', targetHandle: 'top' } as Record<string, unknown>),
      });
    }
  }
}


function extractLayers(layerSummary: unknown): string[] {
  if (!layerSummary) return [];
  if (Array.isArray(layerSummary)) {
    return layerSummary
      .filter(
        (l): l is { layer: string } =>
          typeof l === 'object' && l !== null && 'layer' in l
      )
      .map((l) => l.layer);
  }
  return [];
}
