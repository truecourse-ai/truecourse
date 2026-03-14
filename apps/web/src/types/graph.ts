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
  insightCount: number;
  hasHighSeverity: boolean;
  onExplain?: (nodeId: string) => void;
};

export type GraphNode = Node<ServiceNodeData, 'service'>;

export type DependencyEdgeData = {
  label: string;
  dependencyCount: number;
  hasHttpCalls: boolean;
};

export type GraphEdge = Edge<DependencyEdgeData>;

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
  { layer: 'service', color: '#10b981', label: LAYER_LABELS.service },
  { layer: 'data', color: '#8b5cf6', label: LAYER_LABELS.data },
  { layer: 'external', color: '#f97316', label: LAYER_LABELS.external },
];
