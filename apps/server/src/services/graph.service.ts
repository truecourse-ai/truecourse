import dagre from 'dagre';

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

export function buildGraphData(
  services: ServiceData[],
  dependencies: DependencyData[]
): GraphData {
  const g = new dagre.graphlib.Graph();

  g.setGraph({
    rankdir: 'TB',
    nodesep: 80,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });

  g.setDefaultEdgeLabel(() => ({}));

  // Sort services by rank for consistent layout
  const sortedServices = [...services].sort(
    (a, b) => getServiceRank(a.type) - getServiceRank(b.type)
  );

  // Add nodes
  for (const service of sortedServices) {
    g.setNode(service.id, {
      width: 280,
      height: 120,
      rank: getServiceRank(service.type),
    });
  }

  // Add edges
  for (const dep of dependencies) {
    g.setEdge(dep.sourceServiceId, dep.targetServiceId);
  }

  // Run dagre layout
  dagre.layout(g);

  // Build graph nodes from dagre positions
  const nodes: GraphNode[] = sortedServices.map((service) => {
    const nodeWithPosition = g.node(service.id);
    const layers = extractLayers(service.layerSummary);

    return {
      id: service.id,
      type: 'serviceNode',
      position: {
        x: nodeWithPosition.x - 140, // center the node (width/2)
        y: nodeWithPosition.y - 60, // center the node (height/2)
      },
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
  }));

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
  data: '#f59e0b',     // amber
  external: '#ef4444', // red
};

export function buildLayerGraphData(
  servicesList: ServiceData[],
  serviceDeps: DependencyData[],
  layersList: LayerData[],
  layerDeps: LayerDepData[],
): GraphData {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Build a map of serviceName → serviceId
  const serviceNameToId = new Map<string, string>();
  for (const svc of servicesList) {
    serviceNameToId.set(svc.name, svc.id);
  }

  // Group layers by service
  const layersByService = new Map<string, LayerData[]>();
  for (const layer of layersList) {
    const svcLayers = layersByService.get(layer.serviceName) || [];
    svcLayers.push(layer);
    layersByService.set(layer.serviceName, svcLayers);
  }

  // Use dagre for overall service positioning
  const outerGraph = new dagre.graphlib.Graph();
  outerGraph.setGraph({
    rankdir: 'TB',
    nodesep: 150,
    ranksep: 200,
    marginx: 60,
    marginy: 60,
  });
  outerGraph.setDefaultEdgeLabel(() => ({}));

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

    outerGraph.setNode(service.id, {
      width: SERVICE_GROUP_WIDTH,
      height: groupHeight,
      rank: getServiceRank(service.type),
    });
  }

  // Add service-level edges for layout
  for (const dep of serviceDeps) {
    outerGraph.setEdge(dep.sourceServiceId, dep.targetServiceId);
  }

  dagre.layout(outerGraph);

  // Create group nodes (service containers) and layer sub-nodes
  for (const service of servicesList) {
    const outerNode = outerGraph.node(service.id);
    const svcLayers = (layersByService.get(service.name) || []).sort(
      (a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99)
    );

    const layerCount = Math.max(svcLayers.length, 1);
    let totalLayerHeight2 = 0;
    for (const l of svcLayers) {
      totalLayerHeight2 += getLayerNodeHeight(l.fileCount);
    }
    if (svcLayers.length === 0) totalLayerHeight2 = LAYER_NODE_BASE_HEIGHT;
    const groupHeight =
      GROUP_PADDING_TOP +
      totalLayerHeight2 +
      (layerCount - 1) * LAYER_GAP +
      GROUP_PADDING_BOTTOM;

    const groupX = outerNode.x - SERVICE_GROUP_WIDTH / 2;
    const groupY = outerNode.y - groupHeight / 2;

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

  return { nodes, edges };
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
