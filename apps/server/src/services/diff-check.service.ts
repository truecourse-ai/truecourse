import path from 'path';
import { simpleGit } from 'simple-git';
import { runAnalysis, runDeterministicModuleChecks, type AnalysisProgressCallback, type AnalysisResult } from './analyzer.service.js';
import { createLLMProvider, type DiffViolationItem } from './llm/provider.js';
import { getEnabledRules } from './rules.service.js';
export interface BaselineViolation {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
  targetServiceId?: string;
  targetServiceName?: string;
  targetModuleId?: string;
  targetModuleName?: string;
  targetMethodId?: string;
  targetMethodName?: string;
  fixPrompt?: string;
  createdAt: string;
}

export interface DiffAnalysisInput {
  repoPath: string;
  branch: string | undefined;
  onProgress: AnalysisProgressCallback;
}

export interface DiffAnalysisOutput {
  analysisResult: AnalysisResult;
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
}

export interface DiffViolationCheckInput {
  repoPath: string;
  analysisResult: AnalysisResult;
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  baselineViolations: BaselineViolation[];
  baselineLayerViolations: string[];
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  onProgress: AnalysisProgressCallback;
}

export interface DiffCheckOutput {
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  resolvedViolationIds: string[];
  newViolations: DiffViolationItem[];
  affectedNodeIds: {
    services: string[];
    layers: string[];
    modules: string[];
    methods: string[];
  };
  summary: {
    newCount: number;
    resolvedCount: number;
  };
  analysisResult: AnalysisResult;
}

/**
 * Phase 1: Run analysis on dirty tree + get changed files.
 * No LLM calls — persistence happens between this and the violation check.
 */
export async function runDiffAnalysis(input: DiffAnalysisInput): Promise<DiffAnalysisOutput> {
  const { repoPath, branch, onProgress } = input;

  // 1. Full analysis on dirty state (no stash)
  onProgress({ step: 'analyzing', percent: 10, detail: 'Analyzing dirty working tree...' });
  const result = await runAnalysis(repoPath, branch, onProgress, { skipStash: true });

  // 2. Get changed files from git
  const git = simpleGit(repoPath);
  const statusResult = await git.status();

  const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];
  for (const f of statusResult.not_added) changedFiles.push({ path: f, status: 'new' });
  for (const f of statusResult.created) changedFiles.push({ path: f, status: 'new' });
  for (const f of statusResult.modified) changedFiles.push({ path: f, status: 'modified' });
  for (const f of statusResult.staged) {
    if (!changedFiles.some((cf) => cf.path === f)) changedFiles.push({ path: f, status: 'modified' });
  }
  for (const f of statusResult.deleted) changedFiles.push({ path: f, status: 'deleted' });

  return { analysisResult: result, changedFiles };
}

/**
 * Phase 2: Run LLM violation check using real DB IDs from persistence.
 */
export async function runDiffViolationCheck(input: DiffViolationCheckInput): Promise<DiffCheckOutput> {
  const {
    repoPath, analysisResult: result, changedFiles,
    baselineViolations, baselineLayerViolations,
    serviceIdMap, moduleIdMap, methodIdMap,
    onProgress,
  } = input;

  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      resolvedViolationIds: [],
      newViolations: [],
      affectedNodeIds: { services: [], layers: [], modules: [], methods: [] },
      summary: { newCount: 0, resolvedCount: 0 },
      analysisResult: result,
    };
  }

  // 3. Load rules from database and check deterministic module violations
  const allRules = await getEnabledRules();
  const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
  const enabledLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt)
    .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

  const moduleViolations = runDeterministicModuleChecks(result, enabledDeterministic);

  // 4. Partition existing violations by category
  const serviceBaseline = baselineViolations.filter((i) => i.type === 'service');
  const dbBaseline = baselineViolations.filter((i) => i.type === 'database');
  const moduleBaseline = baselineViolations.filter((i) => i.type === 'module' || i.type === 'function');

  // 5. Build LLM contexts using real DB IDs
  const archRules = enabledLlmRules.filter((r) => r.category === 'service');
  const dbRules = enabledLlmRules.filter((r) => r.category === 'database');
  const moduleRules = enabledLlmRules.filter((r) => r.category === 'module');

  const serviceDtos = result.services.map((s) => ({
    id: serviceIdMap.get(s.name) || s.name,
    name: s.name,
    type: s.type,
    framework: s.framework || undefined,
    fileCount: s.fileCount,
    layers: (s.layers || []).map((l) => l.layer),
  }));

  const depDtos = result.dependencies.map((d) => ({
    source: d.source,
    target: d.target,
    count: d.dependencies.length + (d.httpCalls?.length || 0),
    type: d.httpCalls && d.httpCalls.length > 0 ? 'http' : 'import',
  }));

  const violationDescriptions = (result.layerDependencies || [])
    .filter((d) => d.isViolation)
    .map((v) => `${v.sourceLayer} → ${v.targetLayer} in ${v.sourceServiceName}: ${v.violationReason || 'layer violation'}`);

  const provider = createLLMProvider();
  const changedFilePaths = changedFiles.map((f) => f.path);

  onProgress({ step: 'analyzing', percent: 85, detail: 'Running diff checks...' });

  const diffResult = await provider.generateDiffViolations({
    service: {
      architecture: result.architecture,
      services: serviceDtos,
      dependencies: depDtos,
      violations: violationDescriptions,
      baselineViolations: baselineLayerViolations,
      llmRules: archRules,
      changedFiles: changedFilePaths,
      existingViolations: serviceBaseline.map((i) => ({
        id: i.id, type: i.type, title: i.title, content: i.content, severity: i.severity,
      })),
    },
    database: result.databaseResult && result.databaseResult.databases.length > 0 ? {
      databases: result.databaseResult.databases.map((d) => ({
        id: d.name,
        name: d.name,
        type: d.type,
        driver: d.driver,
        tableCount: d.tables.length,
        connectedServices: d.connectedServices,
        tables: d.tables.map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({
            name: c.name, type: c.type,
            isNullable: c.isNullable, isPrimaryKey: c.isPrimaryKey,
            isForeignKey: c.isForeignKey, referencesTable: c.referencesTable,
          })),
        })),
        relations: d.relations.map((r) => ({
          sourceTable: r.sourceTable, targetTable: r.targetTable, foreignKeyColumn: r.foreignKeyColumn,
        })),
      })),
      llmRules: dbRules,
      changedFiles: changedFilePaths,
      existingViolations: dbBaseline.map((i) => ({
        id: i.id, type: i.type, title: i.title, content: i.content, severity: i.severity,
      })),
    } : undefined,
    module: result.modules && result.modules.length > 0 ? {
      modules: result.modules.map((m) => ({
        id: moduleIdMap.get(`${m.serviceName}::${m.name}::${m.filePath}`) || `${m.serviceName}::${m.name}`,
        name: m.name,
        kind: m.kind,
        serviceName: m.serviceName,
        layerName: m.layerName,
        methodCount: m.methodCount,
        propertyCount: m.propertyCount,
        importCount: m.importCount,
        exportCount: m.exportCount,
        superClass: m.superClass || undefined,
        lineCount: m.lineCount || undefined,
      })),
      methods: (result.methods || []).map((m) => ({
        id: methodIdMap.get(`${m.serviceName}::${m.moduleName}::${m.name}::${m.filePath}`) || undefined,
        moduleName: m.moduleName,
        name: m.name,
        signature: m.signature,
        paramCount: m.paramCount,
        returnType: m.returnType || undefined,
        isAsync: m.isAsync,
        lineCount: m.lineCount || undefined,
        statementCount: m.statementCount || undefined,
        maxNestingDepth: m.maxNestingDepth || undefined,
      })),
      moduleDependencies: (result.moduleLevelDependencies || []).map((d) => ({
        sourceModule: d.sourceModule,
        targetModule: d.targetModule,
        importedNames: d.importedNames,
      })),
      methodDependencies: (result.methodLevelDependencies || []).map((d) => ({
        callerMethod: d.callerMethod,
        callerModule: d.callerModule,
        calleeMethod: d.calleeMethod,
        calleeModule: d.calleeModule,
        callCount: d.callCount,
      })),
      llmRules: moduleRules,
      changedFiles: changedFilePaths,
      violations: moduleViolations.map((v) => ({
        ruleKey: v.ruleKey,
        title: v.title,
        description: v.description,
        severity: v.severity,
        serviceName: v.serviceName,
        moduleName: v.moduleName,
        methodName: v.methodName,
      })),
      existingViolations: moduleBaseline.map((i) => ({
        id: i.id, type: i.type, title: i.title, content: i.content, severity: i.severity,
      })),
    } : undefined,
  });

  // 6. Post-process LLM results: deduplicate new violations and filter false resolves

  // 6a. Remove "new" violations that duplicate existing ones (title match)
  const existingTitles = new Set(baselineViolations.map((i) => i.title.toLowerCase().trim()));
  const dedupedNewViolations = diffResult.newViolations.filter((n) => {
    return !existingTitles.has(n.title.toLowerCase().trim());
  });

  // 6b. Filter out false resolves — only allow resolving violations whose target
  // service/module overlaps with services affected by changed files
  const changedServices = new Set<string>();
  for (const svc of result.services) {
    const relRoot = path.relative(repoPath, svc.rootPath);
    for (const file of changedFiles) {
      if (file.path.startsWith(relRoot + '/') || file.path === relRoot) {
        changedServices.add(svc.name);
      }
    }
  }

  const validResolvedIds = diffResult.resolvedViolationIds.filter((id) => {
    const violation = baselineViolations.find((v) => v.id === id);
    if (!violation) return false;
    // If the violation has a target service, only allow resolve if that service was affected
    if (violation.targetServiceName) {
      return changedServices.has(violation.targetServiceName);
    }
    // No target service — allow it (can't scope it)
    return true;
  });

  onProgress({ step: 'analyzing', percent: 95, detail: 'Computing affected nodes...' });

  // 7. Compute affected node IDs from changed files + new/resolved violations
  const affectedServices = new Set(changedServices);
  const affectedLayers = new Set<string>();
  const affectedModules = new Set<string>();
  const affectedMethods = new Set<string>();

  // Map new violations to affected nodes
  for (const v of dedupedNewViolations) {
    if (v.targetServiceName) affectedServices.add(v.targetServiceName);
    if (v.targetModuleName && v.targetServiceName) {
      affectedModules.add(`${v.targetServiceName}::${v.targetModuleName}`);
    }
    if (v.targetMethodName && v.targetModuleName && v.targetServiceName) {
      affectedMethods.add(`${v.targetServiceName}::${v.targetModuleName}::${v.targetMethodName}`);
    }
  }

  // Map resolved violations to affected nodes
  const resolvedSet = new Set(validResolvedIds);
  for (const v of baselineViolations) {
    if (!resolvedSet.has(v.id)) continue;
    if (v.targetServiceName) affectedServices.add(v.targetServiceName);
  }

  return {
    changedFiles,
    resolvedViolationIds: validResolvedIds,
    newViolations: dedupedNewViolations,
    affectedNodeIds: {
      services: [...affectedServices],
      layers: [...affectedLayers],
      modules: [...affectedModules],
      methods: [...affectedMethods],
    },
    summary: {
      newCount: dedupedNewViolations.length,
      resolvedCount: validResolvedIds.length,
    },
    analysisResult: result,
  };
}
