/**
 * Single source of truth for converting raw node info (from the main graph
 * API or from an ADR fragment snapshot) into the `data` shapes that
 * `ServiceNode` / `ModuleNode` / `DatabaseNode` expect.
 *
 * Both `useGraph.ts` (dashboard) and `AdrGraphFragmentDiagram.tsx` (ADR
 * Living Fragments) call these. If a node component's data shape changes,
 * updating these builders keeps every consumer in sync and prevents the
 * drift that previously showed up as descriptions not wrapping in ADR but
 * wrapping in the main graph.
 */
import type { ServiceNodeData, ServiceNodeInfo } from '@/types/graph';

export type ServiceNodeInput = {
  label: string;
  description?: string | null;
  serviceType?: string | null;
  framework?: string | null;
  fileCount?: number | null;
  layers?: string[] | null;
  rootPath?: string | null;
  violationCount?: number;
  hasHighSeverity?: boolean;
};

export function buildServiceNodeData(input: ServiceNodeInput): ServiceNodeData {
  const serviceInfo: ServiceNodeInfo = {
    type: input.serviceType ?? 'unknown',
    framework: input.framework ?? null,
    fileCount: input.fileCount ?? 0,
    layers: (input.layers ?? []).map((l) => ({ layer: l, confidence: 1, evidence: [] })),
    rootPath: input.rootPath ?? '',
  };
  return {
    label: input.label,
    description: input.description ?? undefined,
    serviceInfo,
    violationCount: input.violationCount ?? 0,
    hasHighSeverity: input.hasHighSeverity ?? false,
  };
}

export type DatabaseNodeInput = {
  label: string;
  databaseType?: string | null;
  tableCount?: number | null;
  connectedServices?: string[] | null;
  framework?: string | null;
};

export function buildDatabaseNodeData(input: DatabaseNodeInput) {
  return {
    label: input.label,
    databaseType: input.databaseType ?? input.label,
    tableCount: input.tableCount ?? 0,
    connectedServices: input.connectedServices ?? [],
    ...(input.framework ? { framework: input.framework } : {}),
  };
}

export type ModuleNodeInput = {
  label: string;
  moduleKind?: string | null;
  methodCount?: number | null;
  layerColor?: string | null;
};

export function buildModuleNodeData(input: ModuleNodeInput) {
  return {
    label: input.label,
    moduleKind: input.moduleKind ?? 'module',
    methodCount: input.methodCount ?? 0,
    layerColor: input.layerColor ?? 'rgba(148, 163, 184, 0.5)',
  };
}
