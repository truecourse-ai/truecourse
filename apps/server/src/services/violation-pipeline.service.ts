import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../config/database.js';
import {
  services,
  deterministicViolations,
  violations,
  codeViolations,
} from '../db/schema.js';
import { checkCodeRules, parseFile, detectLanguage } from '@truecourse/analyzer';
import type { CodeViolation } from '@truecourse/shared';
import type { ModuleViolation, ServiceViolation } from '@truecourse/analyzer';
import { runDeterministicModuleChecks, runDeterministicMethodChecks, runDeterministicServiceChecks, type AnalysisResult } from './analyzer.service.js';
import { getEnabledRules } from './rules.service.js';
import { createLLMProvider, type CodeViolationContext, type CodeViolationsResult } from './llm/provider.js';
import { generateViolations, generateViolationsWithLifecycle } from './violation.service.js';
import {
  persistViolationsWithLifecycle,
  persistCodeViolationsWithLifecycle,
} from './violation-lifecycle.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViolationPipelineInput {
  repoId: string;
  repoPath: string;
  analysisId: string;
  result: AnalysisResult;
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  dbIdMap: Map<string, string>;
  /** Previous active violations for lifecycle tracking */
  previousActiveViolations: {
    id: string;
    type: string;
    title: string;
    content: string;
    severity: string;
    targetServiceId: string | null;
    targetServiceName: string | null;
    targetDatabaseId: string | null;
    targetModuleId: string | null;
    targetModuleName: string | null;
    targetMethodId: string | null;
    targetMethodName: string | null;
    targetTable: string | null;
    fixPrompt: string | null;
    firstSeenAnalysisId: string | null;
    firstSeenAt: Date | null;
  }[];
  /** Previous active code violations for lifecycle tracking */
  previousActiveCodeViolations: {
    id: string;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    columnStart: number;
    columnEnd: number;
    ruleKey: string;
    severity: string;
    title: string;
    content: string;
    snippet: string;
    fixPrompt: string | null;
    firstSeenAnalysisId: string | null;
    firstSeenAt: Date | null;
  }[];
  /** Previous deterministic violations for lifecycle comparison */
  previousDeterministicViolations: {
    id: string;
    ruleKey: string;
    category: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    moduleName: string | null;
    methodName: string | null;
  }[];
  /** If set, only run code rules on these files (for diff mode performance) */
  changedFileSet?: Set<string>;
  /** Progress callback */
  onProgress?: (progress: { step: string; percent: number; detail?: string }) => void;
}

export interface ViolationPipelineResult {
  serviceDescriptions: { id: string; description: string }[];
  /** For diff mode: new violations from LLM */
  newViolations?: import('./llm/provider.js').DiffViolationItem[];
  /** For diff mode: resolved violation IDs */
  resolvedViolationIds?: string[];
  /** All new code violations (deterministic + LLM) */
  codeViolations: CodeViolation[];
  /** Number of resolved code violations (for badge counts) */
  codeResolvedCount: number;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Shared violation pipeline used by both normal and diff analysis routes.
 * Runs deterministic checks, persists them, runs LLM violations, persists results.
 */
export async function runViolationPipeline(input: ViolationPipelineInput): Promise<ViolationPipelineResult> {
  const {
    repoId, repoPath, analysisId, result,
    serviceIdMap, moduleIdMap, methodIdMap, dbIdMap,
    previousActiveViolations, previousActiveCodeViolations, previousDeterministicViolations,
    changedFileSet, onProgress,
  } = input;

  // 1. Load rules
  const allRules = await getEnabledRules();

  // 2. Run all deterministic checks (service, module, method)
  const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
  const serviceViolationResults: ServiceViolation[] = runDeterministicServiceChecks(result, enabledDeterministic);
  const moduleViolationResults: ModuleViolation[] = runDeterministicModuleChecks(result, enabledDeterministic);
  const methodViolationResults: ModuleViolation[] = runDeterministicMethodChecks(result, enabledDeterministic);

  // 3. Persist deterministic violations
  const detViolationIdMap = new Map<string, string>();
  for (const v of serviceViolationResults) {
    const [row] = await db.insert(deterministicViolations).values({
      analysisId,
      ruleKey: v.ruleKey,
      category: 'service',
      title: v.title,
      description: v.description,
      severity: v.severity,
      serviceName: v.serviceName,
      relatedServiceName: v.relatedServiceName || null,
      isDependencyViolation: v.relatedServiceName != null,
    }).returning({ id: deterministicViolations.id });
    detViolationIdMap.set(`service::${v.ruleKey}::${v.serviceName}::${v.title}`, row.id);
  }
  for (const v of [...moduleViolationResults, ...methodViolationResults]) {
    const category = v.methodName ? 'method' : 'module';
    const [row] = await db.insert(deterministicViolations).values({
      analysisId,
      ruleKey: v.ruleKey,
      category,
      title: v.title,
      description: v.description,
      severity: v.severity,
      serviceName: v.serviceName,
      moduleName: v.moduleName || null,
      methodName: v.methodName || null,
      filePath: v.filePath || null,
      relatedModuleName: v.relatedModuleName || null,
      isDependencyViolation: v.relatedModuleName != null,
    }).returning({ id: deterministicViolations.id });
    detViolationIdMap.set(`${category}::${v.ruleKey}::${v.serviceName}::${v.title}`, row.id);
  }

  // 4. Run code-level rules and collect file contents for LLM code rules
  const enabledCodeRules = allRules.filter((r) => r.category === 'code' && r.type === 'deterministic');
  const enabledLlmCodeRules = allRules.filter((r) => r.category === 'code' && r.type === 'llm' && r.prompt);
  const allCodeViolations: CodeViolation[] = [];
  const fileContents: Map<string, { content: string; lineCount: number }> = new Map();

  // Determine which files to scan
  const filesToScan = changedFileSet
    ? [...changedFileSet].map((relPath) => ({ filePath: relPath, resolve: true }))
    : (result.fileAnalyses || []).map((fa) => ({ filePath: fa.filePath, resolve: !path.isAbsolute(fa.filePath) }));

  if ((enabledCodeRules.length > 0 || enabledLlmCodeRules.length > 0) && filesToScan.length > 0) {
    onProgress?.({ step: 'analyzing', percent: 82, detail: 'Running code checks...' });

    for (const { filePath, resolve } of filesToScan) {
      try {
        const lang = detectLanguage(filePath);
        if (!lang) continue;
        const absPath = resolve ? path.resolve(repoPath, filePath) : (path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath));
        if (!fs.existsSync(absPath)) continue;
        const content = fs.readFileSync(absPath, 'utf-8');
        const lineCount = content.split('\n').length;
        fileContents.set(changedFileSet ? absPath : filePath, { content, lineCount });

        if (enabledCodeRules.length > 0) {
          const scanPath = changedFileSet ? filePath : filePath;
          const tree = parseFile(scanPath, content, lang);
          const codeRuleViolations = checkCodeRules(tree, changedFileSet ? absPath : filePath, content, enabledCodeRules);
          allCodeViolations.push(...codeRuleViolations);
        }
      } catch {
        // Skip files that fail to parse
      }
    }
  }

  // 5. Build LLM code violation batches
  const MAX_CHARS_PER_BATCH = 100_000;
  const HALF_BATCH = MAX_CHARS_PER_BATCH / 2;
  const llmCodeBatches: CodeViolationContext[] = [];
  const llmCodeRulesDtos = enabledLlmCodeRules.map((r) => ({
    name: r.name,
    severity: r.severity,
    prompt: r.prompt!,
  }));

  // Build a lookup of previous LLM code violations by file path
  const prevLlmCodeByFile = new Map<string, typeof previousActiveCodeViolations>();
  for (const cv of previousActiveCodeViolations) {
    // Only include LLM-generated code violations (not deterministic ones)
    if (!cv.ruleKey.startsWith('llm/')) continue;
    if (!prevLlmCodeByFile.has(cv.filePath)) prevLlmCodeByFile.set(cv.filePath, []);
    prevLlmCodeByFile.get(cv.filePath)!.push(cv);
  }

  if (enabledLlmCodeRules.length > 0 && fileContents.size > 0) {
    let currentBatch: { path: string; content: string }[] = [];
    let currentChars = 0;

    const addBatch = (files: { path: string; content: string }[]) => {
      const batchFilePaths = new Set(files.map((f) => f.path));
      const existing = [...prevLlmCodeByFile.entries()]
        .filter(([fp]) => batchFilePaths.has(fp))
        .flatMap(([, violations]) => violations);
      llmCodeBatches.push({
        files,
        llmRules: llmCodeRulesDtos,
        existingViolations: existing.length > 0 ? existing : undefined,
      });
    };

    for (const [filePath, { content }] of fileContents) {
      const fileChars = content.length;
      if (fileChars > HALF_BATCH) {
        if (currentBatch.length > 0) {
          addBatch(currentBatch);
          currentBatch = [];
          currentChars = 0;
        }
        addBatch([{ path: filePath, content }]);
        continue;
      }
      if (currentChars + fileChars > MAX_CHARS_PER_BATCH && currentBatch.length > 0) {
        addBatch(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }
      currentBatch.push({ path: filePath, content });
      currentChars += fileChars;
    }
    if (currentBatch.length > 0) {
      addBatch(currentBatch);
    }
  }

  const llmCodeRuleNameToKey = new Map(enabledLlmCodeRules.map((r) => [r.name, r.key]));
  const validFilePaths = new Set(fileContents.keys());

  // 6. Build violation generation input
  onProgress?.({ step: 'analyzing', percent: 85, detail: 'Running checks...' });

  const enabledLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt && r.category !== 'code')
    .map((r) => ({ name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

  const analysisServices = result.services.map((s) => ({
    id: serviceIdMap.get(s.name)!,
    name: s.name,
    type: s.type,
    framework: s.framework || undefined,
    fileCount: s.fileCount,
    layerSummary: s.layers,
  }));

  const analysisDeps = result.dependencies.map((d) => ({
    sourceServiceName: d.source,
    targetServiceName: d.target,
    dependencyCount: d.dependencies.length + (d.httpCalls?.length || 0),
    dependencyType: d.httpCalls && d.httpCalls.length > 0 ? 'http' : 'import',
  }));

  const violationModules = result.modules?.map((m) => ({
    id: moduleIdMap.get(`${m.serviceName}::${m.name}::${m.filePath}`) || '',
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
  })).filter((m) => m.id);

  const violationMethods = result.methods?.map((m) => ({
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
  }));

  const violationModuleDeps = result.moduleLevelDependencies?.map((d) => {
    const srcName = result.modules?.find((m) => m.serviceName === d.sourceService && m.name === d.sourceModule)?.name;
    const tgtName = result.modules?.find((m) => m.serviceName === d.targetService && m.name === d.targetModule)?.name;
    return {
      sourceModule: srcName || d.sourceModule,
      targetModule: tgtName || d.targetModule,
      importedNames: d.importedNames,
    };
  });

  // Partition existing violations by category
  const existingServiceViolations = previousActiveViolations
    .filter((v) => v.type === 'service')
    .map((v) => ({ id: v.id, type: v.type, title: v.title, content: v.content, severity: v.severity }));
  const existingDatabaseViolations = previousActiveViolations
    .filter((v) => v.type === 'database')
    .map((v) => ({ id: v.id, type: v.type, title: v.title, content: v.content, severity: v.severity }));
  const existingModuleViolations = previousActiveViolations
    .filter((v) => v.type === 'module' || v.type === 'function')
    .map((v) => ({ id: v.id, type: v.type, title: v.title, content: v.content, severity: v.severity }));

  const hasExistingViolations = previousActiveViolations.length > 0;

  const violationInput = {
    architecture: result.architecture,
    services: analysisServices,
    dependencies: analysisDeps,
    databases: result.databaseResult?.databases.map((d) => ({
      id: dbIdMap.get(d.name)!,
      name: d.name,
      type: d.type,
      driver: d.driver,
      tableCount: d.tables.length,
      connectedServices: d.connectedServices,
      tables: d.tables.map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isNullable: c.isNullable,
          isPrimaryKey: c.isPrimaryKey,
          isForeignKey: c.isForeignKey,
          referencesTable: c.referencesTable,
        })),
      })),
      relations: d.relations.map((r) => ({
        sourceTable: r.sourceTable,
        targetTable: r.targetTable,
        foreignKeyColumn: r.foreignKeyColumn,
      })),
    })),
    llmRules: enabledLlmRules,
    modules: violationModules,
    methods: violationMethods,
    moduleDependencies: violationModuleDeps,
    methodDependencies: (result.methodLevelDependencies || []).map((d) => ({
      callerMethod: d.callerMethod,
      callerModule: d.callerModule,
      calleeMethod: d.calleeMethod,
      calleeModule: d.calleeModule,
      callCount: d.callCount,
    })),
    moduleViolations: [...moduleViolationResults, ...methodViolationResults].map((v) => {
      const moduleKey = v.moduleName ? `${v.serviceName}::${v.moduleName}::${v.filePath}` : undefined;
      const methodKey = v.methodName && v.moduleName
        ? `${v.serviceName}::${v.moduleName}::${v.methodName}::${v.filePath}` : undefined;
      const category = v.methodName ? 'method' : 'module';
      const detKey = `${category}::${v.ruleKey}::${v.serviceName}::${v.title}`;
      return {
        ...v,
        serviceId: serviceIdMap.get(v.serviceName),
        moduleId: moduleKey ? moduleIdMap.get(moduleKey) : undefined,
        methodId: methodKey ? methodIdMap.get(methodKey) : undefined,
        deterministicViolationId: detViolationIdMap.get(detKey),
      };
    }),
    serviceViolations: serviceViolationResults.map((v) => ({
      ...v,
      deterministicViolationId: detViolationIdMap.get(`service::${v.ruleKey}::${v.serviceName}::${v.title}`),
    })),
    existingServiceViolations: hasExistingViolations ? existingServiceViolations : undefined,
    existingDatabaseViolations: hasExistingViolations ? existingDatabaseViolations : undefined,
    existingModuleViolations: hasExistingViolations ? existingModuleViolations : undefined,
    baselineServiceViolations: previousDeterministicViolations.length > 0
      ? previousDeterministicViolations
          .filter((d) => d.category === 'service')
          .map((d) => `- [detId: ${d.id}] [${d.severity.toUpperCase()}] ${d.title}: ${d.description} (rule: ${d.ruleKey}, service: ${d.serviceName})`)
      : undefined,
    baselineModuleViolations: previousDeterministicViolations.length > 0
      ? previousDeterministicViolations
          .filter((d) => d.category === 'module' || d.category === 'method')
          .map((d) => `- [detId: ${d.id}] [${d.severity.toUpperCase()}] ${d.title}: ${d.description} (rule: ${d.ruleKey}, service: ${d.serviceName}${d.moduleName ? `, module: ${d.moduleName}` : ''}${d.methodName ? `, method: ${d.methodName}` : ''})`)
      : undefined,
  };

  // 7. Run LLM violations + code violations in parallel
  const llmCodePromise = llmCodeBatches.length > 0
    ? createLLMProvider().generateAllCodeViolations(llmCodeBatches)
    : Promise.resolve({ violations: [] } as CodeViolationsResult);

  let serviceDescriptions: { id: string; description: string }[] = [];
  let newViolations: import('./llm/provider.js').DiffViolationItem[] | undefined;
  let resolvedViolationIds: string[] | undefined;
  let llmCodeResolvedIds: string[] = [];
  let llmCodeUnchangedIds: string[] = [];

  if (hasExistingViolations) {
    const archViolationsPromise = generateViolationsWithLifecycle(violationInput);
    const [archResult, codeResult] = await Promise.all([archViolationsPromise, llmCodePromise]);
    serviceDescriptions = archResult.serviceDescriptions;
    newViolations = archResult.newViolations;
    resolvedViolationIds = archResult.resolvedViolationIds;

    const serviceNameToId = new Map(result.services.map((s) => [s.name, serviceIdMap.get(s.name)!]));
    const moduleNameToId = new Map([...moduleIdMap.entries()].map(([key, mid]) => {
      const parts = key.split('::');
      return [parts[1], mid] as [string, string];
    }));
    const methodNameToId = new Map([...methodIdMap.entries()].map(([key, mid]) => {
      const parts = key.split('::');
      return [parts[2], mid] as [string, string];
    }));

    await persistViolationsWithLifecycle({
      analysisId,
      repoId,
      newViolations: archResult.newViolations,
      resolvedViolationIds: archResult.resolvedViolationIds,
      previousActiveViolations,
      serviceNameToId,
      moduleNameToId,
      methodNameToId,
    });

    processLlmCodeViolations(codeResult, validFilePaths, fileContents, llmCodeRuleNameToKey, allCodeViolations);
    llmCodeResolvedIds = codeResult.resolvedViolationIds || [];
    llmCodeUnchangedIds = codeResult.unchangedViolationIds || [];
  } else {
    const archViolationsPromise = generateViolations(violationInput);
    const [archResult, codeResult] = await Promise.all([archViolationsPromise, llmCodePromise]);
    serviceDescriptions = archResult.serviceDescriptions;

    // First run: convert to lifecycle format for consistent return type
    newViolations = archResult.violations.map((v: import('@truecourse/shared').Violation) => ({
      type: v.type,
      title: v.title,
      content: v.content,
      severity: v.severity,
      targetServiceId: v.targetServiceId ?? null,
      targetModuleId: v.targetModuleId ?? null,
      targetMethodId: v.targetMethodId ?? null,
      targetServiceName: null,
      targetModuleName: null,
      targetMethodName: null,
      fixPrompt: v.fixPrompt ?? null,
      deterministicViolationId: v.deterministicViolationId ?? null,
    }));
    resolvedViolationIds = [];

    for (const violation of archResult.violations) {
      await db.insert(violations).values({
        id: uuidv4(),
        repoId,
        analysisId,
        type: violation.type,
        title: violation.title,
        content: violation.content,
        severity: violation.severity,
        status: 'new',
        targetServiceId: violation.targetServiceId || null,
        targetDatabaseId: violation.targetDatabaseId || null,
        targetModuleId: violation.targetModuleId || null,
        targetMethodId: violation.targetMethodId || null,
        targetTable: violation.targetTable || null,
        fixPrompt: violation.fixPrompt || null,
        deterministicViolationId: violation.deterministicViolationId || null,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: new Date(),
      });
    }

    processLlmCodeViolations(codeResult, validFilePaths, fileContents, llmCodeRuleNameToKey, allCodeViolations);
  }

  // 8. Save service descriptions
  for (const desc of serviceDescriptions) {
    if (desc.id) {
      await db
        .update(services)
        .set({ description: desc.description })
        .where(eq(services.id, desc.id));
    }
  }

  // 9. Persist code violations with lifecycle tracking
  // Three groups:
  // a) LLM code violations with lifecycle decisions → use LLM's unchanged/resolved
  // b) Deterministic code violations in changed files → use deterministic matching
  // c) Previous violations for unchanged files → auto carry forward

  const scannedFilePaths = new Set(fileContents.keys());
  const llmLifecycleIds = new Set([...llmCodeUnchangedIds, ...llmCodeResolvedIds]);
  const now = new Date();
  let codeResolvedCount = 0;

  // a) LLM lifecycle: carry forward unchanged, mark resolved
  for (const prevId of llmCodeUnchangedIds) {
    const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
    if (!prev) continue;
    await db.insert(codeViolations).values({
      analysisId,
      filePath: prev.filePath,
      lineStart: prev.lineStart,
      lineEnd: prev.lineEnd,
      columnStart: prev.columnStart,
      columnEnd: prev.columnEnd,
      ruleKey: prev.ruleKey,
      severity: prev.severity,
      status: 'unchanged',
      title: prev.title,
      content: prev.content,
      snippet: prev.snippet,
      fixPrompt: prev.fixPrompt,
      firstSeenAnalysisId: prev.firstSeenAnalysisId,
      firstSeenAt: prev.firstSeenAt,
      previousCodeViolationId: prev.id,
    });
  }

  for (const prevId of llmCodeResolvedIds) {
    const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
    if (!prev) continue;
    await db.insert(codeViolations).values({
      analysisId,
      filePath: prev.filePath,
      lineStart: prev.lineStart,
      lineEnd: prev.lineEnd,
      columnStart: prev.columnStart,
      columnEnd: prev.columnEnd,
      ruleKey: prev.ruleKey,
      severity: prev.severity,
      status: 'resolved',
      title: prev.title,
      content: prev.content,
      snippet: prev.snippet,
      fixPrompt: prev.fixPrompt,
      firstSeenAnalysisId: prev.firstSeenAnalysisId,
      firstSeenAt: prev.firstSeenAt,
      previousCodeViolationId: prev.id,
      resolvedAt: now,
    });
    codeResolvedCount++;
  }

  // b) Deterministic matching for code violations NOT handled by LLM lifecycle
  const prevForDeterministicMatching = previousActiveCodeViolations.filter(
    (v) => !llmLifecycleIds.has(v.id) && scannedFilePaths.has(v.filePath),
  );

  if (allCodeViolations.length > 0 || prevForDeterministicMatching.length > 0) {
    await persistCodeViolationsWithLifecycle({
      analysisId,
      currentCodeViolations: allCodeViolations,
      previousActiveCodeViolations: prevForDeterministicMatching,
    });

    const currentKeys = new Set(allCodeViolations.map((cv) =>
      `${cv.filePath}::${cv.ruleKey}::${cv.lineStart}::${cv.lineEnd}`
    ));
    for (const prev of prevForDeterministicMatching) {
      const key = `${prev.filePath}::${prev.ruleKey}::${prev.lineStart}::${prev.lineEnd}`;
      if (!currentKeys.has(key)) codeResolvedCount++;
    }
  }

  // c) Auto carry forward violations for unchanged files
  const prevInUnchangedFiles = previousActiveCodeViolations.filter(
    (v) => !llmLifecycleIds.has(v.id) && !scannedFilePaths.has(v.filePath),
  );

  for (const prev of prevInUnchangedFiles) {
    await db.insert(codeViolations).values({
      analysisId,
      filePath: prev.filePath,
      lineStart: prev.lineStart,
      lineEnd: prev.lineEnd,
      columnStart: prev.columnStart,
      columnEnd: prev.columnEnd,
      ruleKey: prev.ruleKey,
      severity: prev.severity,
      status: 'unchanged',
      title: prev.title,
      content: prev.content,
      snippet: prev.snippet,
      fixPrompt: prev.fixPrompt,
      firstSeenAnalysisId: prev.firstSeenAnalysisId,
      firstSeenAt: prev.firstSeenAt,
      previousCodeViolationId: prev.id,
    });
  }

  return {
    serviceDescriptions,
    newViolations,
    resolvedViolationIds,
    codeViolations: allCodeViolations,
    codeResolvedCount,
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function processLlmCodeViolations(
  codeResult: { violations: { ruleName: string; filePath: string; lineStart: number; lineEnd: number; severity: string; title: string; content: string; fixPrompt: string | null }[] },
  validFilePaths: Set<string>,
  fileContents: Map<string, { content: string; lineCount: number }>,
  llmCodeRuleNameToKey: Map<string, string>,
  allCodeViolations: CodeViolation[],
) {
  if (codeResult.violations.length === 0) return;

  for (const v of codeResult.violations) {
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

    allCodeViolations.push({
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
}
