import path from 'path';
import { simpleGit } from 'simple-git';
import { runAnalysis, runDeterministicModuleChecks, type AnalysisProgressCallback } from './analyzer.service.js';
import { createLLMProvider, type DiffInsightItem } from './llm/provider.js';
import { getEnabledRules } from './rules.service.js';
export interface BaselineInsight {
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

export interface DiffCheckInput {
  repoPath: string;
  branch: string | undefined;
  baselineInsights: BaselineInsight[];
  baselineLayerViolations: string[];
  onProgress: AnalysisProgressCallback;
}

export interface DiffCheckOutput {
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  resolvedInsightIds: string[];
  newInsights: DiffInsightItem[];
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
}

export async function runDiffCheck(input: DiffCheckInput): Promise<DiffCheckOutput> {
  const { repoPath, branch, baselineInsights, baselineLayerViolations, onProgress } = input;

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

  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      resolvedInsightIds: [],
      newInsights: [],
      affectedNodeIds: { services: [], layers: [], modules: [], methods: [] },
      summary: { newCount: 0, resolvedCount: 0 },
    };
  }

  // 3. Load rules from database and check deterministic module violations
  const allRules = await getEnabledRules();
  const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
  const enabledLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt)
    .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

  const moduleViolations = runDeterministicModuleChecks(result, enabledDeterministic);

  // 4. Partition existing insights by category
  const archInsights = baselineInsights.filter((i) => i.type === 'service');
  const dbInsights = baselineInsights.filter((i) => i.type === 'database');
  const moduleInsights = baselineInsights.filter((i) => i.type === 'module' || i.type === 'function');

  // 5. Build LLM contexts
  const archRules = enabledLlmRules.filter((r) => r.category === 'service');
  const dbRules = enabledLlmRules.filter((r) => r.category === 'database');
  const moduleRules = enabledLlmRules.filter((r) => r.category === 'module');

  const serviceDtos = result.services.map((s) => ({
    id: s.name, // Use name as ID since we don't have DB IDs yet
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

  const diffResult = await provider.generateDiffInsights({
    architecture: {
      architecture: result.architecture,
      services: serviceDtos,
      dependencies: depDtos,
      violations: violationDescriptions,
      baselineViolations: baselineLayerViolations,
      llmRules: archRules,
      changedFiles: changedFilePaths,
      existingViolations: archInsights.map((i) => ({
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
      existingViolations: dbInsights.map((i) => ({
        id: i.id, type: i.type, title: i.title, content: i.content, severity: i.severity,
      })),
    } : undefined,
    module: result.modules && result.modules.length > 0 ? {
      services: serviceDtos.map((s) => ({ id: s.id, name: s.name })),
      modules: result.modules.map((m) => ({
        id: `${m.serviceName}::${m.name}`,
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
      existingViolations: moduleInsights.map((i) => ({
        id: i.id, type: i.type, title: i.title, content: i.content, severity: i.severity,
      })),
    } : undefined,
  });

  // 6. Post-process LLM results: deduplicate new violations and filter false resolves

  // 6a. Remove "new" violations that duplicate existing ones (title match)
  const existingTitles = new Set(baselineInsights.map((i) => i.title.toLowerCase().trim()));
  const dedupedNewInsights = diffResult.newInsights.filter((n) => {
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

  const validResolvedIds = diffResult.resolvedInsightIds.filter((id) => {
    const insight = baselineInsights.find((i) => i.id === id);
    if (!insight) return false;
    // If the insight has a target service, only allow resolve if that service was affected
    if (insight.targetServiceName) {
      return changedServices.has(insight.targetServiceName);
    }
    // No target service — allow it (can't scope it)
    return true;
  });

  onProgress({ step: 'analyzing', percent: 95, detail: 'Computing affected nodes...' });

  // 7. Compute affected node IDs from changed files + new/resolved insights
  const affectedServices = new Set(changedServices);
  const affectedLayers = new Set<string>();
  const affectedModules = new Set<string>();
  const affectedMethods = new Set<string>();

  // Map new insights to affected nodes
  for (const insight of dedupedNewInsights) {
    if (insight.targetServiceName) affectedServices.add(insight.targetServiceName);
    if (insight.targetModuleName && insight.targetServiceName) {
      affectedModules.add(`${insight.targetServiceName}::${insight.targetModuleName}`);
    }
    if (insight.targetMethodName && insight.targetModuleName && insight.targetServiceName) {
      affectedMethods.add(`${insight.targetServiceName}::${insight.targetModuleName}::${insight.targetMethodName}`);
    }
  }

  // Map resolved insights to affected nodes
  const resolvedSet = new Set(validResolvedIds);
  for (const insight of baselineInsights) {
    if (!resolvedSet.has(insight.id)) continue;
    if (insight.targetServiceName) affectedServices.add(insight.targetServiceName);
  }

  return {
    changedFiles,
    resolvedInsightIds: validResolvedIds,
    newInsights: dedupedNewInsights,
    affectedNodeIds: {
      services: [...affectedServices],
      layers: [...affectedLayers],
      modules: [...affectedModules],
      methods: [...affectedMethods],
    },
    summary: {
      newCount: dedupedNewInsights.length,
      resolvedCount: validResolvedIds.length,
    },
  };
}
