import path from 'path';
import fs from 'node:fs';
import { simpleGit } from 'simple-git';
import { runAnalysis, runDeterministicModuleChecks, type AnalysisProgressCallback, type AnalysisResult } from './analyzer.service.js';
import { createLLMProvider, type DiffViolationItem, type CodeViolationContext } from './llm/provider.js';
import { getEnabledRules } from './rules.service.js';
import { checkCodeRules, parseFile, detectLanguage } from '@truecourse/analyzer';
import type { CodeViolation } from '@truecourse/shared';
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

export interface BaselineCodeViolation {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  ruleKey: string;
  severity: string;
  title: string;
  content: string;
}

export interface DiffViolationCheckInput {
  repoPath: string;
  analysisResult: AnalysisResult;
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  baselineViolations: BaselineViolation[];
  baselineLayerViolations: string[];
  baselineCodeViolations: BaselineCodeViolation[];
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  onProgress: AnalysisProgressCallback;
}

export interface DiffCheckOutput {
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
  resolvedViolationIds: string[];
  newViolations: DiffViolationItem[];
  codeViolations: CodeViolation[];
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
    baselineViolations, baselineLayerViolations, baselineCodeViolations,
    serviceIdMap, moduleIdMap, methodIdMap,
    onProgress,
  } = input;

  if (changedFiles.length === 0) {
    return {
      changedFiles: [],
      resolvedViolationIds: [],
      newViolations: [],
      codeViolations: [],
      affectedNodeIds: { services: [], layers: [], modules: [], methods: [] },
      summary: { newCount: 0, resolvedCount: 0 },
      analysisResult: result,
    };
  }

  // 3. Load rules from database and check deterministic module violations
  const allRules = await getEnabledRules();
  const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
  const enabledLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt && r.category !== 'code')
    .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

  const moduleViolations = runDeterministicModuleChecks(result, enabledDeterministic);

  // 3b. Run code rules on changed files only
  const enabledCodeRules = allRules.filter((r) => r.category === 'code' && r.type === 'deterministic');
  const enabledLlmCodeRules = allRules.filter((r) => r.category === 'code' && r.type === 'llm' && r.prompt);
  const changedFileSet = new Set(changedFiles.filter((f) => f.status !== 'deleted').map((f) => f.path));
  const codeViolations: CodeViolation[] = [];
  const fileContents = new Map<string, { content: string; lineCount: number }>();

  for (const relPath of changedFileSet) {
    try {
      const lang = detectLanguage(relPath);
      if (!lang) continue;
      const absPath = path.resolve(repoPath, relPath);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf-8');
      const lineCount = content.split('\n').length;
      fileContents.set(absPath, { content, lineCount });

      if (enabledCodeRules.length > 0) {
        const tree = parseFile(relPath, content, lang);
        const violations = checkCodeRules(tree, absPath, content, enabledCodeRules);
        codeViolations.push(...violations);
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  // Build LLM code violation batches from changed files
  const MAX_CHARS_PER_BATCH = 100_000;
  const HALF_BATCH = MAX_CHARS_PER_BATCH / 2;
  const llmCodeBatches: CodeViolationContext[] = [];
  const llmCodeRuleDtos = enabledLlmCodeRules.map((r) => ({
    name: r.name,
    severity: r.severity,
    prompt: r.prompt!,
  }));
  const llmCodeRuleNameToKey = new Map(enabledLlmCodeRules.map((r) => [r.name, r.key]));

  if (enabledLlmCodeRules.length > 0 && fileContents.size > 0) {
    let currentBatch: { path: string; content: string }[] = [];
    let currentChars = 0;

    for (const [filePath, { content }] of fileContents) {
      const fileChars = content.length;
      if (fileChars > HALF_BATCH) {
        if (currentBatch.length > 0) {
          llmCodeBatches.push({ files: currentBatch, llmRules: llmCodeRuleDtos });
          currentBatch = [];
          currentChars = 0;
        }
        llmCodeBatches.push({ files: [{ path: filePath, content }], llmRules: llmCodeRuleDtos });
        continue;
      }
      if (currentChars + fileChars > MAX_CHARS_PER_BATCH && currentBatch.length > 0) {
        llmCodeBatches.push({ files: currentBatch, llmRules: llmCodeRuleDtos });
        currentBatch = [];
        currentChars = 0;
      }
      currentBatch.push({ path: filePath, content });
      currentChars += fileChars;
    }
    if (currentBatch.length > 0) {
      llmCodeBatches.push({ files: currentBatch, llmRules: llmCodeRuleDtos });
    }
  }

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

  // Run arch/module diff violations and LLM code violations in parallel
  const llmCodePromise = llmCodeBatches.length > 0
    ? provider.generateAllCodeViolations(llmCodeBatches)
    : Promise.resolve({ violations: [] });

  const diffPromise = provider.generateDiffViolations({
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

  const [diffResult, llmCodeResult] = await Promise.all([diffPromise, llmCodePromise]);

  // Post-process LLM code violations
  const validFilePaths = new Set(fileContents.keys());
  for (const v of llmCodeResult.violations) {
    if (!validFilePaths.has(v.filePath)) continue;
    const fileInfo = fileContents.get(v.filePath)!;
    const lineStart = Math.max(1, Math.min(v.lineStart, fileInfo.lineCount));
    const lineEnd = Math.max(lineStart, Math.min(v.lineEnd, fileInfo.lineCount));
    const lines = fileInfo.content.split('\n');
    const snippet = lines.slice(lineStart - 1, lineEnd).join('\n');
    const strippedName = v.ruleName.replace(/^\[(?:LOW|MEDIUM|HIGH|CRITICAL)\]\s*/i, '');
    const ruleKey = llmCodeRuleNameToKey.get(v.ruleName)
      || llmCodeRuleNameToKey.get(strippedName)
      || v.ruleName;

    codeViolations.push({
      ruleKey,
      filePath: v.filePath,
      lineStart,
      lineEnd,
      columnStart: 0,
      columnEnd: 0,
      severity: v.severity,
      title: v.title,
      content: v.content,
      snippet,
      fixPrompt: v.fixPrompt ?? undefined,
    });
  }

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
    codeViolations,
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
