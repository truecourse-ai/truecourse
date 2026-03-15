import {
  createLLMProvider,
  type ArchitectureContext,
  type ArchitectureInsightContext,
  type DatabaseInsightContext,
  type ModuleInsightContext,
  type InsightsResult,
} from './llm/provider.js';
import type { Insight } from '@truecourse/shared';

export interface InsightGenerationInput {
  architecture: string;
  services: {
    id: string;
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
  databases?: {
    id: string;
    name: string;
    type: string;
    driver: string;
    tableCount: number;
    connectedServices: string[];
    tables?: {
      name: string;
      columns: { name: string; type: string; isNullable?: boolean; isPrimaryKey?: boolean; isForeignKey?: boolean; referencesTable?: string }[];
    }[];
    relations?: { sourceTable: string; targetTable: string; foreignKeyColumn: string }[];
  }[];
  llmRules?: {
    name: string;
    severity: string;
    prompt: string;
    category: string;
  }[];
  modules?: {
    id: string;
    name: string;
    kind: string;
    serviceName: string;
    layerName: string;
    methodCount: number;
    propertyCount: number;
    importCount: number;
    exportCount: number;
    superClass?: string;
    lineCount?: number;
  }[];
  methods?: {
    id?: string;
    moduleName: string;
    name: string;
    signature: string;
    paramCount: number;
    returnType?: string;
    isAsync: boolean;
    lineCount?: number;
    statementCount?: number;
    maxNestingDepth?: number;
  }[];
  moduleDependencies?: {
    sourceModule: string;
    targetModule: string;
    importedNames: string[];
  }[];
  moduleViolations?: {
    ruleKey: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    serviceId?: string;
    moduleName?: string;
    moduleId?: string;
    methodName?: string;
    methodId?: string;
  }[];
}

export async function generateInsights(
  input: InsightGenerationInput,
  onProgress?: (step: string) => void,
): Promise<InsightsResult> {
  const provider = createLLMProvider();

  // Partition rules by category
  const archRules = (input.llmRules || []).filter((r) => r.category === 'architecture');
  const dbRules = (input.llmRules || []).filter((r) => r.category === 'database');
  const moduleRules = (input.llmRules || []).filter((r) => r.category === 'module');

  const serviceDtos = input.services.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    framework: s.framework,
    fileCount: s.fileCount,
    layers: extractLayerNames(s.layerSummary),
  }));

  const depDtos = input.dependencies.map((d) => ({
    source: d.sourceServiceName,
    target: d.targetServiceName,
    count: d.dependencyCount || 0,
    type: d.dependencyType || undefined,
  }));

  // Valid ID sets for post-call validation
  const validServiceIds = new Set(input.services.map((s) => s.id));
  const validDatabaseIds = new Set((input.databases || []).map((d) => d.id));
  const validModuleIds = new Set((input.modules || []).map((m) => m.id));
  const validMethodIds = new Set((input.methods || []).filter((m) => m.id).map((m) => m.id!));

  // --- Build promises ---

  // 1. Architecture call (always runs)
  const archContext: ArchitectureInsightContext = {
    architecture: input.architecture,
    services: serviceDtos,
    dependencies: depDtos,
    violations: input.violations,
    llmRules: archRules,
  };
  const archPromise = provider.generateArchitectureInsights(archContext).then((result) => {
    onProgress?.('Architecture insights ready');
    return result;
  });

  // 2. Database call (only if databases exist)
  const hasDBs = input.databases && input.databases.length > 0;
  const dbPromise = hasDBs
    ? (() => {
        const dbContext: DatabaseInsightContext = {
          databases: input.databases!,
          llmRules: dbRules,
        };
        return provider.generateDatabaseInsights(dbContext).then((result) => {
          onProgress?.('Database insights ready');
          return result;
        });
      })()
    : null;

  // 3. Module call (only if modules exist)
  const hasModules = input.modules && input.modules.length > 0;
  const modulePromise = hasModules
    ? (() => {
        const moduleContext: ModuleInsightContext = {
          services: input.services.map((s) => ({ id: s.id, name: s.name })),
          modules: input.modules!,
          methods: input.methods || [],
          moduleDependencies: input.moduleDependencies || [],
          llmRules: moduleRules,
          violations: input.moduleViolations,
        };
        return provider.generateModuleInsights(moduleContext).then((result) => {
          onProgress?.('Module insights ready');
          return result;
        });
      })()
    : null;

  // Run all in parallel
  const promises = [archPromise, dbPromise, modulePromise].filter(Boolean) as Promise<unknown>[];
  const results = await Promise.allSettled(promises);

  // --- Merge results ---
  const allInsights: Insight[] = [];
  let serviceDescriptions: { id: string; description: string }[] = [];

  // Map settled results back to their call type
  let idx = 0;

  // Architecture result
  const archResult = results[idx++];
  if (archResult.status === 'fulfilled') {
    const arch = archResult.value as { insights: Insight[]; serviceDescriptions: { id: string; description: string }[] };
    // Validate service IDs
    for (const insight of arch.insights) {
      if (insight.targetServiceId && !validServiceIds.has(insight.targetServiceId)) {
        insight.targetServiceId = undefined;
      }
      allInsights.push(insight);
    }
    serviceDescriptions = arch.serviceDescriptions.filter((d) => validServiceIds.has(d.id));
  } else {
    console.error('[Insights] Architecture call failed:', archResult.reason);
  }

  // Database result
  if (hasDBs) {
    const dbResult = results[idx++];
    if (dbResult.status === 'fulfilled') {
      const dbData = dbResult.value as { insights: Insight[] };
      for (const insight of dbData.insights) {
        if (insight.targetDatabaseId && !validDatabaseIds.has(insight.targetDatabaseId)) {
          insight.targetDatabaseId = undefined;
        }
        allInsights.push(insight);
      }
    } else {
      console.error('[Insights] Database call failed:', dbResult.reason);
    }
  }

  // Module result
  if (hasModules) {
    const moduleResult = results[idx++];
    if (moduleResult.status === 'fulfilled') {
      const modData = moduleResult.value as { insights: Insight[] };
      for (const insight of modData.insights) {
        if (insight.targetServiceId && !validServiceIds.has(insight.targetServiceId)) {
          insight.targetServiceId = undefined;
        }
        if (insight.targetModuleId && !validModuleIds.has(insight.targetModuleId)) {
          insight.targetModuleId = undefined;
        }
        if (insight.targetMethodId && !validMethodIds.has(insight.targetMethodId)) {
          insight.targetMethodId = undefined;
        }
        allInsights.push(insight);
      }
    } else {
      console.error('[Insights] Module call failed:', moduleResult.reason);
    }
  }

  return { insights: allInsights, serviceDescriptions };
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
