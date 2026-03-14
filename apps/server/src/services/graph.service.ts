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
