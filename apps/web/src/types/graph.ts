import type { Node, Edge } from '@xyflow/react';
import type { Layer } from '@truecourse/shared';

export type ServiceNodeInfo = {
  type: string;
  framework: string | null;
  fileCount: number;
  layers: { layer: string; confidence: number; evidence: string[] }[];
  rootPath: string;
};

export type ServiceNodeData = {
  label: string;
  description?: string;
  serviceInfo: ServiceNodeInfo;
  violationCount: number;
  hasHighSeverity: boolean;
  onExplain?: (nodeId: string) => void;
};

export type GraphNode = Node<ServiceNodeData, 'service'>;

// Layer node data (child of a service group node)
export type LayerNodeData = {
  label: string;
  layer: Layer;
  fileCount: number;
  layerColor: string;
};

export type LayerGraphNode = Node<LayerNodeData, 'layer'>;

// Service group node data (parent container in layer view)
export type ServiceGroupNodeData = {
  label: string;
  description?: string;
  serviceType: string;
  framework?: string;
  fileCount: number;
  layers: string[];
};

export type ServiceGroupGraphNode = Node<ServiceGroupNodeData, 'serviceGroup'>;

export type DependencyEdgeData = {
  label: string;
  dependencyCount: number;
  hasHttpCalls: boolean;
  isViolation?: boolean;
  violationReason?: string;
};

export type GraphEdge = Edge<DependencyEdgeData>;

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type DepthLevel = 'services' | 'modules' | 'methods';

// Semantic zoom levels (fine-grained, driven by zoom scale)
export type SemanticZoomLevel = 'services' | 'layers' | 'directories' | 'modules' | 'methods';

// Directory node data (groups modules by filesystem path)
export type DirectoryNodeData = {
  label: string;
  dirPath: string;
  moduleCount: number;
  violationCount: number;
  layerColor: string;
};

export type LayerColor = {
  layer: Layer;
  color: string;
};

export const LAYER_LABELS: Record<Layer, string> = {
  api: 'Routes & Controllers',
  service: 'Business Logic',
  data: 'Database & ORM',
  external: 'HTTP Clients',
};

export const LAYER_COLORS: (LayerColor & { label: string })[] = [
  { layer: 'api', color: '#3b82f6', label: LAYER_LABELS.api },
  { layer: 'service', color: '#8b5cf6', label: LAYER_LABELS.service },
  { layer: 'data', color: '#10b981', label: LAYER_LABELS.data },
  { layer: 'external', color: '#f97316', label: LAYER_LABELS.external },
];
