import {
  createLLMProvider,
  type ArchitectureContext,
  type InsightsResult,
} from './llm/provider.js';

export interface InsightGenerationInput {
  architecture: string;
  services: {
    name: string;
    type: string;
    framework?: string;
    fileCount: number;
    layerSummary: unknown;
  }[];
  dependencies: {
    sourceServiceName: string;
    targetServiceName: string;
    dependencyCount: number | null;
    dependencyType: string | null;
  }[];
  violations?: string[];
}

export async function generateInsights(
  input: InsightGenerationInput
): Promise<InsightsResult> {
  const context: ArchitectureContext = {
    architecture: input.architecture,
    services: input.services.map((s) => ({
      name: s.name,
      type: s.type,
      framework: s.framework,
      fileCount: s.fileCount,
      layers: extractLayerNames(s.layerSummary),
    })),
    dependencies: input.dependencies.map((d) => ({
      source: d.sourceServiceName,
      target: d.targetServiceName,
      count: d.dependencyCount || 0,
      type: d.dependencyType || undefined,
    })),
    violations: input.violations,
  };

  const provider = createLLMProvider();
  return provider.generateInsights(context);
}

function extractLayerNames(layerSummary: unknown): string[] {
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
