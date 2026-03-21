import {
  createLLMProvider,
  type ServiceViolationContext,
  type DatabaseViolationContext,
  type ModuleViolationContext,
  type ViolationsResult,
  type AllViolationsLifecycleResult,
  type ExistingViolation,
} from './llm/provider.js';
import type { Violation } from '@truecourse/shared';

export interface ViolationGenerationInput {
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
  methodDependencies?: {
    callerMethod: string;
    callerModule: string;
    calleeMethod: string;
    calleeModule: string;
    callCount: number;
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
    deterministicViolationId?: string;
  }[];
  /** Service deterministic violations */
  serviceViolations?: {
    ruleKey: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    deterministicViolationId?: string;
  }[];
  /** Existing violations per category for lifecycle mode */
  existingServiceViolations?: ExistingViolation[];
  existingDatabaseViolations?: ExistingViolation[];
  existingModuleViolations?: ExistingViolation[];
  /** Previous deterministic service violations for lifecycle comparison */
  baselineServiceViolations?: string[];
  /** Previous deterministic module violations for lifecycle comparison */
  baselineModuleViolations?: string[];
}

export async function generateViolations(
  input: ViolationGenerationInput,
  onProgress?: (step: string) => void,
): Promise<ViolationsResult> {
  const provider = createLLMProvider();

  // Partition rules by category
  const archRules = (input.llmRules || []).filter((r) => r.category === 'service');
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

  // --- Build contexts ---

  const serviceContext: ServiceViolationContext = {
    architecture: input.architecture,
    services: serviceDtos,
    dependencies: depDtos,
    llmRules: archRules,
    violations: input.serviceViolations,
  };

  const hasDBs = input.databases && input.databases.length > 0;
  const dbContext: DatabaseViolationContext | undefined = hasDBs
    ? { databases: input.databases!, llmRules: dbRules }
    : undefined;

  const serviceNameToIdMap = new Map(serviceDtos.map((s) => [s.name, s.id]));

  const hasModules = input.modules && input.modules.length > 0;
  const moduleContext: ModuleViolationContext | undefined = hasModules
    ? {
        modules: input.modules!.map((m) => ({ ...m, serviceId: serviceNameToIdMap.get(m.serviceName) })),
        methods: input.methods || [],
        moduleDependencies: input.moduleDependencies || [],
        methodDependencies: input.methodDependencies || [],
        llmRules: moduleRules,
        violations: input.moduleViolations,
      }
    : undefined;

  // Run all in parallel via single traced call
  const results = await provider.generateAllViolations({
    service: serviceContext,
    database: dbContext,
    module: moduleContext,
  });

  // --- Merge results ---
  const allViolations: Violation[] = [];
  let serviceDescriptions: { id: string; description: string }[] = [];

  // Service result
  if (results.service) {
    onProgress?.('Service architecture checks done');
    for (const violation of results.service.violations) {
      if (violation.targetServiceId && !validServiceIds.has(violation.targetServiceId)) {
        violation.targetServiceId = undefined;
      }
      allViolations.push(violation);
    }
    serviceDescriptions = results.service.serviceDescriptions.filter((d) => validServiceIds.has(d.id));
  }

  // Database result
  if (results.database) {
    onProgress?.('Database schema checks done');
    for (const violation of results.database.violations) {
      if (violation.targetDatabaseId && !validDatabaseIds.has(violation.targetDatabaseId)) {
        violation.targetDatabaseId = undefined;
      }
      allViolations.push(violation);
    }
  }

  // Module result
  if (results.module) {
    onProgress?.('Module & function checks done');
    for (const violation of results.module.violations) {
      if (violation.targetServiceId && !validServiceIds.has(violation.targetServiceId)) {
        violation.targetServiceId = undefined;
      }
      if (violation.targetModuleId && !validModuleIds.has(violation.targetModuleId)) {
        violation.targetModuleId = undefined;
      }
      if (violation.targetMethodId && !validMethodIds.has(violation.targetMethodId)) {
        violation.targetMethodId = undefined;
      }
      allViolations.push(violation);
    }
  }

  return { violations: allViolations, serviceDescriptions };
}

/**
 * Generate violations with lifecycle tracking — returns new violations + resolved IDs
 * instead of a flat violations array.
 */
export async function generateViolationsWithLifecycle(
  input: ViolationGenerationInput,
  onProgress?: (step: string) => void,
): Promise<AllViolationsLifecycleResult> {
  const provider = createLLMProvider();

  const archRules = (input.llmRules || []).filter((r) => r.category === 'service');
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

  const serviceContext: ServiceViolationContext = {
    architecture: input.architecture,
    services: serviceDtos,
    dependencies: depDtos,
    llmRules: archRules,
    violations: input.serviceViolations,
    existingViolations: input.existingServiceViolations,
    baselineViolations: input.baselineServiceViolations,
  };

  const hasDBs = input.databases && input.databases.length > 0;
  const dbContext: DatabaseViolationContext | undefined = hasDBs
    ? { databases: input.databases!, llmRules: dbRules, existingViolations: input.existingDatabaseViolations }
    : undefined;

  const serviceNameToIdMap = new Map(serviceDtos.map((s) => [s.name, s.id]));

  const hasModules = input.modules && input.modules.length > 0;
  const moduleContext: ModuleViolationContext | undefined = hasModules
    ? {
        modules: input.modules!.map((m) => ({ ...m, serviceId: serviceNameToIdMap.get(m.serviceName) })),
        methods: input.methods || [],
        moduleDependencies: input.moduleDependencies || [],
        methodDependencies: input.methodDependencies || [],
        llmRules: moduleRules,
        violations: input.moduleViolations,
        existingViolations: input.existingModuleViolations,
        baselineViolations: input.baselineModuleViolations,
      }
    : undefined;

  const result = await provider.generateAllViolationsWithLifecycle({
    service: serviceContext,
    database: dbContext,
    module: moduleContext,
  });

  onProgress?.('All checks done');
  return result;
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
